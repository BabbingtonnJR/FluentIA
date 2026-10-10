// Writes public/icon.svg: the kanji 流 ("flow", as in fluent) drawn with KanjiVG strokes on a vermilion tile.
// Usage: node scripts/make-icon.mjs <strokes.json> <out.svg>
import { readFile, writeFile } from 'node:fs/promises';

const [strokesPath, outPath] = process.argv.slice(2);
const strokes = JSON.parse(await readFile(strokesPath, 'utf8'))['流'];
if (!strokes?.length) throw new Error('No stroke data for 流');

const paths = strokes.map((d) => `<path d="${d}"/>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="96" fill="#c8402f"/>
<g transform="translate(96 96) scale(2.936)" fill="none" stroke="#faf6ee" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${paths}</g>
</svg>
`;
await writeFile(outPath, svg);
console.log(`Wrote ${outPath}`);
