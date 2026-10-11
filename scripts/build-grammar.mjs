// Builds the grammar points for the Japanese pack.
// Source: content/ja/grammar/n*.json, written for Fluentia (see CREDITS.md). Each point has
// its own example sentences with the grammar marked as {cloze}; furigana is added here with
// kuromoji. Points with a `match` regex also borrow up to a few Tatoeba sentences from the
// reading pack, but only where the match lines up with word boundaries (so ても never
// matches inside とても).
//
// Usage: node scripts/build-grammar.mjs <srcDir> <packDir>   (packDir must hold sentences.json)
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { annotate as annotateWith, createTokenizer, grammarFiles, grammarSpan, plainText } from './lib/japanese.mjs';

const [srcDir, packDir] = process.argv.slice(2);
if (!srcDir || !packDir) {
  console.error('Usage: node scripts/build-grammar.mjs <srcDir> <packDir>');
  process.exit(1);
}

const MAX_BORROWED = 4;

const tokenizer = await createTokenizer();
const annotate = (text) => annotateWith(tokenizer, text);

// --- Source points -------------------------------------------------------------
// n4a.json, n4b.json, … : easiest level first, then file order, which is teaching order.
const files = await grammarFiles(srcDir);
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
    const span = grammarSpan(re, plain, annotate(plain).bounds);
    if (!span) continue;
    const [start, end] = span;
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

// The match regex ships too, so the app can spot grammar points in imported subtitles.
const out = points;
await writeFile(path.join(packDir, 'grammar.json'), JSON.stringify(out));

// Record grammar in the manifest so the app knows the pack has it.
const manifestPath = path.join(packDir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.kinds = [...new Set([...manifest.kinds, 'grammar'])];
manifest.counts.grammar = out.length;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const byLevel = [5, 4, 3].map((n) => `N${n}: ${out.filter((p) => p.level === n).length}`).join(', ');
console.log(`Grammar points ${out.length} (${byLevel}), own examples ${out.reduce((s, p) => s + p.examples.filter((e) => !e.i).length, 0)}, borrowed from Tatoeba ${borrowed}`);
