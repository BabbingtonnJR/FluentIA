// Builds the grammar points for the Japanese pack.
// Source: content/ja/grammar/n*.json, written for Fluentia (see CREDITS.md). Each point has
// its own example sentences with the grammar marked as {cloze}; furigana is added here with
// kuromoji. Points with a `match` regex also borrow up to a few Tatoeba sentences from the
// reading pack, but only where the match lines up with word boundaries (so ても never
// matches inside とても).
//
// Usage: node scripts/build-grammar.mjs <srcDir> <packDir>   (packDir must hold sentences.json)
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import kuromoji from 'kuromoji';

const [srcDir, packDir] = process.argv.slice(2);
if (!srcDir || !packDir) {
  console.error('Usage: node scripts/build-grammar.mjs <srcDir> <packDir>');
  process.exit(1);
}

const MAX_BORROWED = 4;

const require = createRequire(import.meta.url);
const dicPath = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict');
const tokenizer = await new Promise((resolve, reject) =>
  kuromoji.builder({ dicPath }).build((err, t) => (err ? reject(err) : resolve(t))),
);

const toHiragana = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const hasKanji = (s) => /\p{Script=Han}/u.test(s);
const plainText = (markup) => markup.replace(/\[([^|\]]+)\|[^\]]*\]/g, '$1');

/** Furigana markup for one token: kana around the kanji is left outside the brackets (降っ → [降|ふ]っ). */
function tokenRuby(surface, readingKatakana) {
  if (!hasKanji(surface) || !readingKatakana || readingKatakana === '*') return surface;
  const s = [...surface];
  const r = [...toHiragana(readingKatakana)];
  let head = '';
  let tail = '';
  while (s.length > 1 && r.length > 1 && !hasKanji(s.at(-1)) && toHiragana(s.at(-1)) === r.at(-1)) {
    tail = s.pop() + tail;
    r.pop();
  }
  while (s.length > 1 && r.length > 1 && !hasKanji(s[0]) && toHiragana(s[0]) === r[0]) {
    head += s.shift();
    r.shift();
  }
  return `${head}[${s.join('')}|${r.join('')}]${tail}`;
}

// IPADIC picks the wrong reading for a few common words; fix them in context (katakana readings).
const READING_FIXES = [
  { surface: /^日本(人|語)?$/, reading: (s) => s.replace('日本', 'ニホン').replace('人', 'ジン').replace('語', 'ゴ') },
  { surface: /^間$/, reading: () => 'アイダ' }, // standalone 間 in 〜間に / 長い間 (間に合う is one token)
  { surface: /^辛$/, reading: () => 'カラ' },
  { surface: /^降り/, when: /[雨雪]/, reading: (s) => s.replace('降', 'フ').replace('り', 'リ') },
  { surface: /^開[きいくけ]/, reading: (s) => `ア${[...s].slice(1).join('')}` }, // 開く (open, intransitive) — 開かれる stays ひら
];

function fixedReading(token, sentence) {
  const fix = READING_FIXES.find((f) => f.surface.test(token.surface_form) && (!f.when || f.when.test(sentence)));
  return fix ? fix.reading(token.surface_form) : token.reading;
}

/** Furigana markup for a whole sentence, plus the character offsets where tokens start and end. */
function annotate(text) {
  const tokens = tokenizer.tokenize(text);
  const bounds = new Set([0]);
  let pos = 0;
  let markup = '';
  for (const t of tokens) {
    markup += tokenRuby(t.surface_form, fixedReading(t, text));
    pos += t.surface_form.length;
    bounds.add(pos);
  }
  return { markup, bounds };
}

// --- Source points -------------------------------------------------------------
// n4a.json, n4b.json, … : easiest level first, then file order, which is teaching order.
const files = (await readdir(srcDir))
  .filter((f) => /^n\d[a-z]?\.json$/.test(f))
  .sort((a, b) => Number(b[1]) - Number(a[1]) || a.localeCompare(b));
const points = [];
const ids = new Set();
const problems = [];
for (const f of files) {
  const level = Number(f[1]);
  for (const p of JSON.parse(await readFile(path.join(srcDir, f), 'utf8'))) {
    const id = `n${level}-${p.id}`;
    if (ids.has(id)) problems.push(`${id}: duplicate id`);
    ids.add(id);
    const examples = [];
    for (const [jp, en] of p.examples) {
      // Furigana written by hand ([一|いっ][週間|しゅうかん]) is kept as is; it's needed where
      // IPADIC reads numbers and counters digit by digit (三千 → さんせん).
      const handRuby = jp.includes('[');
      const m = /^([^{}]*)\{([^{}]+)\}([^{}]*)$/.exec(handRuby ? jp.replace(/\[([^|\]]+)\|[^\]]*\]/g, '$1') : jp);
      if (!m) {
        problems.push(`${id}: example needs exactly one {cloze}: ${jp}`);
        continue;
      }
      const plain = m[1] + m[2] + m[3];
      const markup = handRuby ? jp.replace(/[{}]/g, '') : annotate(plain).markup;
      examples.push({ r: markup, e: en, c: [m[1].length, m[1].length + m[2].length] });
    }
    if (examples.length < 2) problems.push(`${id}: needs at least 2 examples`);
    points.push({ id, level, pattern: p.pattern, meaning: p.meaning, formation: p.formation, notes: p.notes, match: p.match, examples });
  }
}

// --- Borrow Tatoeba examples -----------------------------------------------------
const sentences = JSON.parse(await readFile(path.join(packDir, 'sentences.json'), 'utf8'));
const plainSentences = sentences.map((s) => ({ s, plain: plainText(s.r) }));
let borrowed = 0;
for (const p of points) {
  if (!p.match) continue;
  const re = new RegExp(p.match, 'u');
  const own = new Set(p.examples.map((e) => plainText(e.r)));
  const hits = [];
  for (const { s, plain } of plainSentences) {
    if (own.has(plain)) continue;
    const m = re.exec(plain);
    if (!m) continue;
    // Cloze on the first capture group if there is one, else the whole match.
    const text = m[1] ?? m[0];
    const start = m.index + m[0].indexOf(text);
    const end = start + text.length;
    const { bounds } = annotate(plain);
    if (!bounds.has(start) || !bounds.has(end)) continue;
    hits.push({ s, start, end });
  }
  // Easier and shorter sentences make clearer examples.
  hits.sort((a, b) => b.s.l - a.s.l || a.s.r.length - b.s.r.length);
  for (const h of hits.slice(0, MAX_BORROWED)) {
    p.examples.push({ r: h.s.r, e: h.s.e, c: [h.start, h.end], i: h.s.i });
    borrowed++;
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const out = points.map(({ match, ...p }) => p);
await writeFile(path.join(packDir, 'grammar.json'), JSON.stringify(out));

// Record grammar in the manifest so the app knows the pack has it.
const manifestPath = path.join(packDir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.kinds = [...new Set([...manifest.kinds, 'grammar'])];
manifest.counts.grammar = out.length;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const byLevel = [5, 4, 3].map((n) => `N${n}: ${out.filter((p) => p.level === n).length}`).join(', ');
console.log(`Grammar points ${out.length} (${byLevel}), own examples ${out.reduce((s, p) => s + p.examples.filter((e) => !e.i).length, 0)}, borrowed from Tatoeba ${borrowed}`);
