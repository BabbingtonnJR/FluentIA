// Builds the Japanese content pack from the raw datasets downloaded by fetch-content.mjs.
// Usage: node scripts/build-content.mjs <rawDir> <outDir>
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCsv } from './csv.mjs';

const [rawDir, outDir] = process.argv.slice(2);
if (!rawDir || !outDir) {
  console.error('Usage: node scripts/build-content.mjs <rawDir> <outDir>');
  process.exit(1);
}

const LEVELS = [5, 4, 3];
const hex = (c) => c.codePointAt(0).toString(16).padStart(5, '0');
const isKanji = (c) => /\p{Script=Han}/u.test(c);

const kanjiRaw = JSON.parse(await readFile(path.join(rawDir, 'kanji.json'), 'utf8'));

// --- Kanji -----------------------------------------------------------------
const kanji = [];
const strokes = {};
for (const [char, k] of Object.entries(kanjiRaw)) {
  if (!LEVELS.includes(k.jlpt_new)) continue;
  const svg = await readFile(path.join(rawDir, 'kanjivg', `${hex(char)}.svg`), 'utf8');
  const paths = [...svg.matchAll(/<path id="kvg:[0-9a-f]+-s(\d+)"[^>]*\sd="([^"]+)"/g)]
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => m[2]);
  strokes[char] = paths;
  kanji.push({
    id: char,
    level: k.jlpt_new,
    meanings: (k.meanings ?? []).filter((m) => !/radical/i.test(m)),
    on: k.readings_on ?? [],
    kun: k.readings_kun ?? [],
    strokes: k.strokes ?? paths.length,
    freq: k.freq ?? null,
  });
}
kanji.sort((a, b) => b.level - a.level || (a.freq ?? 9999) - (b.freq ?? 9999));

// Stroke data for the icon kanji even though it is not a study item.
if (!strokes['流']) {
  const svg = await readFile(path.join(rawDir, 'kanjivg', `${hex('流')}.svg`), 'utf8');
  strokes['流'] = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
}

// --- Vocabulary --------------------------------------------------------------
// Introduce easier words first, ranked by the rarest kanji they contain.
// Kana-only words get a mid rank so they are mixed in rather than front-loaded.
function difficulty(word) {
  let worst = 0;
  for (const c of word) {
    if (!isKanji(c)) continue;
    worst = Math.max(worst, kanjiRaw[c]?.freq ?? 2600);
  }
  return worst || 300;
}

const vocab = [];
const seen = new Set();
for (const n of LEVELS) {
  const rows = parseCsv(await readFile(path.join(rawDir, `n${n}.csv`), 'utf8'));
  const [header, ...data] = rows;
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  const levelItems = [];
  for (const row of data) {
    const word = row[col.expression]?.trim();
    const reading = row[col.reading]?.trim() || word;
    const meaning = row[col.meaning]?.trim();
    if (!word || !meaning) continue;
    const id = `${word}|${reading}`;
    if (seen.has(id)) continue; // keep the easiest level a word appears in
    seen.add(id);
    levelItems.push({ id, word, reading, meaning, level: n });
  }
  levelItems.sort((a, b) => difficulty(a.word) - difficulty(b.word));
  vocab.push(...levelItems);
}

// --- Write -------------------------------------------------------------------
const manifest = {
  id: 'ja',
  name: 'Japanese',
  nativeName: '日本語',
  ttsLocale: 'ja-JP',
  levels: LEVELS.map((n) => ({ id: n, label: `N${n}` })),
  kinds: ['vocab', 'kanji'],
  counts: { vocab: vocab.length, kanji: kanji.length },
  builtAt: new Date().toISOString().slice(0, 10),
};

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(path.join(outDir, 'vocab.json'), JSON.stringify(vocab));
await writeFile(path.join(outDir, 'kanji.json'), JSON.stringify(kanji));
await writeFile(path.join(outDir, 'strokes.json'), JSON.stringify(strokes));

const byLevel = (items) => LEVELS.map((n) => `N${n}: ${items.filter((i) => i.level === n).length}`).join(', ');
console.log(`Vocab ${vocab.length} (${byLevel(vocab)})`);
console.log(`Kanji ${kanji.length} (${byLevel(kanji)})`);
