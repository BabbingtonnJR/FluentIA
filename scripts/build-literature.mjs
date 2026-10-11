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
import { analyse, createTokenizer, grammarMatchers, splitRuby, vocabLookup } from './lib/japanese.mjs';

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
  // A LibriVox reading, one track per chapter: only used when its chapters line up with the headings.
  if (w.audio) {
    const headings = body.filter((b) => b.h).length;
    if (headings === w.audio.chapters.length) meta.audio = w.audio;
    else console.warn(`${w.id}: ${w.audio.chapters.length} audio chapters but ${headings} headings; audio left out`);
  }
  // The word-list entries it uses, so the shelf can say how many the learner knows.
  index.push({ ...meta, words: [...new Set(linked.map((x) => x[4]))].sort((x, y) => x - y) });
  await writeFile(path.join(outDir, `${w.id}.json`), JSON.stringify({ ...meta, body }));
}

await writeFile(path.join(outDir, 'index.json'), JSON.stringify(index));

for (const m of index) {
  console.log(`${m.title} — ${m.sentences} sentences, ${m.chars} chars, N5–N3 words ${(m.coverage * 100).toFixed(0)}%, ≈${m.level}${m.audio ? ', with audio' : ''}`);
}
if (unknownGaiji.size) console.warn('Unmapped gaiji (shown as 〓):', [...unknownGaiji].join(' '));
