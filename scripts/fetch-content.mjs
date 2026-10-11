// Downloads the raw open datasets used to build the Japanese content pack.
// Usage: node scripts/fetch-content.mjs <outDir>
//
// Sources (see CREDITS.md):
//   - JLPT vocab lists: jamsinclair/open-anki-jlpt-decks (MIT, based on tanos.co.uk lists)
//   - Kanji data: davidluzgouveia/kanji-data (KANJIDIC, CC BY-SA 4.0; JLPT levels from tanos.co.uk)
//   - Stroke order: KanjiVG (CC BY-SA 3.0)
//   - Example sentences and furigana: Tatoeba per-language exports (CC BY 2.0 FR)
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';

const outDir = process.argv[2];
if (!outDir) {
  console.error('Usage: node scripts/fetch-content.mjs <outDir>');
  process.exit(1);
}

const LEVELS = [5, 4, 3];
const VOCAB_URL = (n) => `https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/main/src/n${n}.csv`;
const KANJI_URL = 'https://raw.githubusercontent.com/davidluzgouveia/kanji-data/master/kanji.json';
const KANJIVG_URL = (hex) => `https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/${hex}.svg`;

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  if (await exists(dest)) return false;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return true;
}

export function kanjivgHex(char) {
  return char.codePointAt(0).toString(16).padStart(5, '0');
}

await mkdir(path.join(outDir, 'kanjivg'), { recursive: true });
await mkdir(path.join(outDir, 'tatoeba'), { recursive: true });

for (const n of LEVELS) await download(VOCAB_URL(n), path.join(outDir, `n${n}.csv`));
await download(KANJI_URL, path.join(outDir, 'kanji.json'));

// Tatoeba exports stay bzip2-compressed; build-sentences.mjs reads them directly (~34 MB).
const TATOEBA_URL = (f) => `https://downloads.tatoeba.org/exports/per_language/${f}.tsv.bz2`;
for (const f of ['jpn/jpn_sentences', 'jpn/jpn_transcriptions', 'jpn/jpn-eng_links', 'eng/eng_sentences']) {
  await download(TATOEBA_URL(f), path.join(outDir, 'tatoeba', `${path.basename(f)}.tsv.bz2`));
}

const kanji = JSON.parse(await readFile(path.join(outDir, 'kanji.json'), 'utf8'));
// 流 is also used for the app icon.
const chars = Object.keys(kanji).filter((k) => LEVELS.includes(kanji[k].jlpt_new));
if (!chars.includes('流')) chars.push('流');

let fetched = 0;
const missing = [];
const queue = [...chars];
async function worker() {
  while (queue.length) {
    const c = queue.shift();
    try {
      if (await download(KANJIVG_URL(kanjivgHex(c)), path.join(outDir, 'kanjivg', `${kanjivgHex(c)}.svg`))) fetched++;
    } catch {
      missing.push(c);
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));

console.log(`Kanji: ${chars.length}, stroke files downloaded now: ${fetched}, missing: ${missing.join('') || 'none'}`);

// Aozora Bunko public-domain stories for the literature reader (content/ja/literature/works.json).
await mkdir(path.join(outDir, 'aozora'), { recursive: true });
const works = JSON.parse(await readFile(new URL('../content/ja/literature/works.json', import.meta.url), 'utf8'));
for (const w of works) await download(w.url, path.join(outDir, 'aozora', `${w.id}.zip`));
