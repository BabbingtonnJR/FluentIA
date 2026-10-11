// Builds the literature reader: public-domain stories from Aozora Bunko (青空文庫), split into
// sentences, with furigana, every word broken down (dictionary form, part of speech, conjugation,
// link to the word list) and the grammar points the app teaches marked where they appear.
//
// Furigana: Aozora's own ruby (狐《きつね》) is the author's or editor's reading and wins; kuromoji
// fills in the rest.
//
// Usage: node scripts/build-literature.mjs <worksJson> <rawDir> <grammarSrcDir> <packDir>
//   rawDir/aozora/<id>.zip come from fetch-content.mjs; packDir must already hold vocab.json.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
  createTokenizer,
  fixedReading,
  grammarMatchers,
  grammarSpan,
  hasKanji,
  isFunctionToken,
  toHiragana,
  tokenRuby,
  vocabLookup,
} from './lib/japanese.mjs';

const [worksJson, rawDir, grammarDir, packDir] = process.argv.slice(2);
if (!worksJson || !rawDir || !grammarDir || !packDir) {
  console.error('Usage: node scripts/build-literature.mjs <worksJson> <rawDir> <grammarSrcDir> <packDir>');
  process.exit(1);
}

// --- Zip ---------------------------------------------------------------------------
/** The first .txt file in a zip archive (Aozora zips hold one text file, deflated). */
function readZipText(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('latin1');
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.endsWith('.txt')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    return method === 8 ? inflateRawSync(data) : data;
  }
  throw new Error('no .txt in zip');
}

// --- Aozora text format ---------------------------------------------------------------
// Characters outside Shift_JIS are described in notes (※［＃「目＋爭」、第3水準1-88-85］).
const GAIJI = { '目＋爭': '睜', '楫のつくり＋戈': '戢', '特のへん＋廴＋聿': '犍', '均のつくり': '勻' };
const unknownGaiji = new Set();

/** Body paragraphs, headings marked, and the credit lines from the footer. */
function parseAozora(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  // Header: title and author, then the notation guide between two rules of dashes.
  const rules = lines.map((l, i) => (/^-{20,}$/.test(l) ? i : -1)).filter((i) => i >= 0);
  const bodyStart = rules.length >= 2 ? rules[1] + 1 : 2;
  const footerAt = lines.findIndex((l) => l.startsWith('底本：'));
  const body = lines.slice(bodyStart, footerAt < 0 ? undefined : footerAt);
  const footer = footerAt < 0 ? [] : lines.slice(footerAt);
  const credit = {
    source: footer[0]?.replace(/^底本：/, '').trim(),
    input: footer.find((l) => l.startsWith('入力：'))?.replace('入力：', '').trim(),
    proof: footer.find((l) => l.startsWith('校正：'))?.replace('校正：', '').trim(),
  };

  const paragraphs = [];
  for (const raw of body) {
    let line = raw.replace(/※［＃「([^」]+)」[^］]*］/g, (_, desc) => {
      if (GAIJI[desc]) return GAIJI[desc];
      unknownGaiji.add(desc);
      return '〓';
    });
    const heading = /［＃「([^」]+)」は[大中小]見出し］/.test(line);
    line = line.replace(/［＃[^］]*］/g, '').trim();
    if (!line) continue;
    paragraphs.push({ heading, text: line });
  }
  return { paragraphs, credit };
}

/** Plain text plus the explicit ruby spans: 狐《きつね》 and ｜十米《メートル》 (｜ marks where the base starts). */
function splitRuby(marked) {
  let plain = '';
  const spans = [];
  const re = /(?:｜([^｜《]+)|([\p{Script=Han}々〆ヶ]+))《([^》]+)》/gu;
  let last = 0;
  for (const m of marked.matchAll(re)) {
    plain += marked.slice(last, m.index).replace(/｜/g, '');
    const base = m[1] ?? m[2];
    spans.push({ start: plain.length, end: plain.length + base.length, reading: m[3] });
    plain += base;
    last = m.index + m[0].length;
  }
  plain += marked.slice(last).replace(/｜/g, '');
  return { plain, spans };
}

/** Sentences: break after 。！？, keeping a closing bracket that follows with its sentence. */
function splitSentences(marked) {
  const out = [];
  let cur = '';
  const chars = [...marked];
  for (let i = 0; i < chars.length; i++) {
    cur += chars[i];
    if (/[。！？]/.test(chars[i])) {
      while (i + 1 < chars.length && /[」』）)]/.test(chars[i + 1])) cur += chars[++i];
      out.push(cur);
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// --- Word breakdown -------------------------------------------------------------------
const POS = {
  名詞: (t) =>
    ({ 代名詞: 'pron', 固有名詞: 'name', 数: 'num', 形容動詞語幹: 'adj-na', サ変接続: 'noun-suru', 非自立: 'noun-dep', 接尾: 'suffix' })[t.pos_detail_1] ?? 'noun',
  動詞: (t) => (['非自立', '接尾'].includes(t.pos_detail_1) ? 'verb-aux' : 'verb'),
  形容詞: (t) => (t.pos_detail_1 === '非自立' ? 'adj-aux' : 'adj-i'),
  副詞: () => 'adv',
  連体詞: () => 'prenoun',
  接続詞: () => 'conj',
  感動詞: () => 'interj',
  助動詞: () => 'aux',
  助詞: (t) =>
    ({ 格助詞: 'p-case', 係助詞: 'p-topic', 副助詞: 'p-adv', 接続助詞: 'p-conj', 終助詞: 'p-end', 連体化: 'p-no', 並立助詞: 'p-list', 副詞化: 'p-adv', '副助詞／並立助詞／終助詞': 'p-adv' })[
      t.pos_detail_1
    ] ?? 'p',
  記号: () => 'sym',
  接頭詞: () => 'prefix',
  フィラー: () => 'filler',
};
const FORM = {
  基本形: 'dict',
  音便基本形: 'dict',
  連用形: 'stem',
  連用ゴザイ接続: 'stem',
  連用ニ接続: 'stem',
  連用タ接続: 'ta',
  連用テ接続: 'te',
  未然形: 'nai',
  未然ヌ接続: 'nai',
  未然レル接続: 'nai',
  未然ウ接続: 'vol',
  仮定形: 'ba',
  仮定縮約１: 'ba',
  命令ｅ: 'imp',
  命令ｒｏ: 'imp',
  命令ｙｏ: 'imp',
  命令ｉ: 'imp',
  体言接続: 'attr',
  ガル接続: 'garu',
};

/**
 * Furigana markup and word breakdown for one sentence. Each word is
 * [surface, dictionary form (if different), part of speech, reading (if it has kanji), vocab index or -1, form],
 * with empty trailing fields dropped.
 */
function analyse(marked, tokenizer, lookup, matchers) {
  const { plain, spans } = splitRuby(marked);
  const tokens = tokenizer.tokenize(plain);
  let markup = '';
  let cursor = 0;
  let pos = 0;
  const bounds = new Set([0]);
  const words = [];
  for (const t of tokens) {
    const a = pos;
    const b = pos + t.surface_form.length;
    pos = b;
    bounds.add(b);
    const explicit = spans.filter((s) => s.start < b && s.end > a);
    const reading = fixedReading(t, plain);

    // Furigana: explicit spans win, and the text they cover may run past this token.
    if (b > cursor) {
      const from = Math.max(a, cursor);
      if (explicit.length) {
        let c = from;
        while (c < b) {
          const s = spans.find((x) => x.start === c);
          if (s) {
            markup += `[${plain.slice(s.start, s.end)}|${s.reading}]`;
            c = s.end;
          } else markup += plain[c++];
        }
        cursor = c;
      } else {
        markup += from === a ? tokenRuby(t.surface_form, reading) : plain.slice(from, b);
        cursor = b;
      }
    }

    const p = POS[t.pos]?.(t) ?? 'other';
    if (p === 'sym') {
      words.push([t.surface_form, '', 'sym']);
      continue;
    }
    // The author's reading beats the dictionary's when the word is exactly one ruby span.
    const own = explicit.length === 1 && explicit[0].start === a && explicit[0].end === b ? explicit[0].reading : null;
    const kana = hasKanji(t.surface_form) ? (own ?? (reading && reading !== '*' ? toHiragana(reading) : '')) : '';
    const idx = !isFunctionToken(t) || t.pos_detail_1 === '代名詞' ? lookup(t) : undefined;
    const base = t.basic_form === '*' ? t.surface_form : t.basic_form;
    const word = [t.surface_form, base === t.surface_form ? '' : base, p, kana, idx ?? -1, FORM[t.conjugated_form] ?? ''];
    while (word.length > 3 && (word.at(-1) === '' || word.at(-1) === -1)) word.pop();
    words.push(word);
  }

  const grammar = [];
  for (const { id, re } of matchers) {
    const span = grammarSpan(re, plain, bounds);
    if (span) grammar.push([id, ...span]);
  }
  const s = { r: markup, w: words };
  if (grammar.length) s.g = grammar;
  return s;
}

// --- Build -----------------------------------------------------------------------------
const works = JSON.parse(await readFile(worksJson, 'utf8'));
const vocab = JSON.parse(await readFile(path.join(packDir, 'vocab.json'), 'utf8'));
const lookup = vocabLookup(vocab);
const matchers = await grammarMatchers(grammarDir);
const tokenizer = await createTokenizer();
const outDir = path.join(packDir, 'literature');
await mkdir(outDir, { recursive: true });

const CONTENT = (pos) => !/^(sym|p|aux|name|num|prefix|suffix|filler|noun-dep|verb-aux|adj-aux)/.test(pos);
const index = [];
for (const w of works) {
  const text = new TextDecoder('shift_jis').decode(readZipText(await readFile(path.join(rawDir, 'aozora', `${w.id}.zip`))));
  const { paragraphs, credit } = parseAozora(text);
  const body = paragraphs.map((p) => (p.heading ? { h: splitRuby(p.text).plain } : { s: splitSentences(p.text).map((m) => analyse(m, tokenizer, lookup, matchers)) }));

  // Share of content words in the N5–N3 list (the app shows the learner's own share too).
  const all = body.flatMap((p) => p.s ?? []);
  const content = all.flatMap((s) => s.w.filter((x) => CONTENT(x[2])));
  const linked = content.filter((x) => (x[4] ?? -1) >= 0);
  const byLevel = { 5: 0, 4: 0, 3: 0 };
  for (const x of linked) byLevel[vocab[x[4]].level]++;
  const chars = all.reduce((n, s) => n + s.w.reduce((k, x) => k + x[0].length, 0), 0);
  const coverage = content.length ? linked.length / content.length : 0;

  const meta = {
    id: w.id,
    title: w.title,
    titleEn: w.titleEn,
    author: w.author,
    authorEn: w.authorEn,
    // A rough guide set by hand in works.json; the stories are listed easiest first.
    level: w.level,
    url: `https://www.aozora.gr.jp/cards/${w.url.match(/cards\/(\d+)/)[1]}/card${w.aozora}.html`,
    credit,
    sentences: all.length,
    chars,
    coverage: Math.round(coverage * 1000) / 1000,
    byLevel,
  };
  // The word-list entries it uses, so the shelf can say how many the learner knows.
  index.push({ ...meta, words: [...new Set(linked.map((x) => x[4]))].sort((x, y) => x - y) });
  await writeFile(path.join(outDir, `${w.id}.json`), JSON.stringify({ ...meta, body }));
}

await writeFile(path.join(outDir, 'index.json'), JSON.stringify(index));

for (const m of index) {
  console.log(`${m.title} — ${m.sentences} sentences, ${m.chars} chars, N5–N3 words ${(m.coverage * 100).toFixed(0)}%, ≈${m.level}`);
}
if (unknownGaiji.size) console.warn('Unmapped gaiji (shown as 〓):', [...unknownGaiji].join(' '));
