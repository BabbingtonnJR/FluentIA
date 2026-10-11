// Builds the comics reader from Pepper&Carrot by David Revoy (CC BY 4.0), Japanese translation.
// Each page's text lives in an SVG layer over the artwork; every <text>/<flowRoot> is one speech
// bubble. Its position on the page is kept (as a share of width and height) so the app can put a
// tappable marker on the bubble, and bubbles are ordered top to bottom, then left to right.
// Each bubble gets the same breakdown as the literature reader.
//
// Usage: node scripts/build-comics.mjs <rawDir> <grammarSrcDir> <packDir>
//   rawDir/peppercarrot/ comes from fetch-content.mjs; packDir must already hold vocab.json.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyse } from './lib/breakdown.mjs';
import { createTokenizer, grammarMatchers, vocabLookup } from './lib/japanese.mjs';

const [rawDir, grammarDir, packDir] = process.argv.slice(2);
if (!rawDir || !grammarDir || !packDir) {
  console.error('Usage: node scripts/build-comics.mjs <rawDir> <grammarSrcDir> <packDir>');
  process.exit(1);
}

const SRC = path.join(rawDir, 'peppercarrot');
const IMAGE = (ep, page) => `https://www.peppercarrot.com/0_sources/${ep}/low-res/ja_Pepper-and-Carrot_by-David-Revoy_${page}.jpg`;
/** Bubbles whose centres are this close vertically (share of page height) count as one row. */
const ROW = 0.05;

// --- SVG -------------------------------------------------------------------------------
const IDENTITY = [1, 0, 0, 1, 0, 0];
const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function parseTransform(t) {
  let m = IDENTITY;
  for (const [, op, args] of (t ?? '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    let n = IDENTITY;
    if (op === 'matrix') n = a;
    else if (op === 'translate') n = [1, 0, 0, 1, a[0], a[1] ?? 0];
    else if (op === 'scale') n = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else if (op === 'rotate') {
      const r = (a[0] * Math.PI) / 180;
      n = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
    }
    m = multiply(m, n);
  }
  return m;
}

const attrs = (s) => Object.fromEntries([...(s ?? '').matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const JP = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const JP_EDGE = '\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Han}ー…、。！？!?「」『』（）';
/** Spaces in Japanese bubbles only mark phrase breaks for layout; drop them next to Japanese. */
const tidy = (s) =>
  s
    .replace(/\s+/g, ' ')
    .replace(new RegExp(`\\s+(?=[${JP_EDGE}])|(?<=[${JP_EDGE}])\\s+`, 'gu'), '')
    .trim();

/** Speech bubbles on one SVG page: text and centre as a share of the page. */
function bubblesOf(svg) {
  const root = attrs(/<svg\b([^>]*)>/.exec(svg)?.[1]);
  const width = parseFloat(root.width);
  const height = parseFloat(root.height);
  const rects = new Map([...svg.matchAll(/<rect\b([^>]*?)\/?>/g)].map((m) => attrs(m[1])).filter((a) => a.id).map((a) => [a.id, a]));

  const out = [];
  const stack = [{ m: IDENTITY }];
  let bubble = null;
  let inRegion = 0;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  for (const m of svg.matchAll(re)) {
    const [, closing, name, rawAttrs, selfClosing, text] = m;
    if (text !== undefined) {
      if (bubble && !inRegion) bubble.text += decode(text);
      continue;
    }
    if (!name) continue;
    if (closing) {
      const top = stack.pop();
      if (name === 'flowRegion') inRegion--;
      if (bubble && top.bubbleRoot) {
        const r = bubble.rect;
        const [x, y] = r ? apply(bubble.m, +r.x + +r.width / 2, +r.y + +r.height / 2) : apply(bubble.m, ...(bubble.anchor ?? [0, 0]));
        const t = tidy(bubble.text);
        if (JP.test(t)) out.push({ text: t, x: x / width, y: y / height });
        bubble = null;
      }
      continue;
    }
    const a = attrs(rawAttrs);
    const frame = { m: multiply(stack.at(-1).m, parseTransform(a.transform)) };
    if (!bubble && (name === 'text' || name === 'flowRoot') && !selfClosing) {
      const shape = /shape-inside:url\(#([^)]+)\)/.exec(a.style ?? '')?.[1];
      bubble = { m: frame.m, text: '', rect: shape ? rects.get(shape) : undefined, anchor: a.x ? [+a.x, +a.y] : undefined };
      frame.bubbleRoot = true;
    } else if (bubble) {
      if (name === 'flowRegion' && !selfClosing) inRegion++;
      if (name === 'rect' && inRegion && !bubble.rect) bubble.rect = a;
      if (name === 'tspan' && !bubble.anchor && a.x && a.y) bubble.anchor = [+a.x, +a.y];
      // A tspan that starts a new line in Inkscape's line-based text.
      if (name === 'tspan' && a['sodipodi:role'] === 'line' && bubble.text) bubble.text += ' ';
    }
    if (!selfClosing) stack.push(frame);
  }
  return out;
}

/** Comic reading order: rows from the top, then left to right within a row. */
function readingOrder(bubbles) {
  return [...bubbles].sort((a, b) => Math.round(a.y / ROW) - Math.round(b.y / ROW) || a.x - b.x);
}

// Credits pages list supporters, mostly in English.
const isCredits = (texts) => /Creative Commons|CC[- ]BY|Patreon|patron|ライセンス/i.test(texts.join(' '));

// --- Build ---------------------------------------------------------------------------------
const vocab = JSON.parse(await readFile(path.join(packDir, 'vocab.json'), 'utf8'));
const lookup = vocabLookup(vocab);
const matchers = await grammarMatchers(grammarDir);
const tokenizer = await createTokenizer();
const outDir = path.join(packDir, 'comics');
await mkdir(outDir, { recursive: true });

const indexHtml = await readFile(path.join(SRC, 'index-ja.html'), 'utf8');
const titles = new Map(
  [...indexHtml.matchAll(/webcomic\/(ep\d+_[^"]+)\.html">エピソード\s*\d+:\s*([^<]+)<\/a>(?:<br><span[^>]*>公開日:\s*([\d-]+))?/g)].map((m) => [
    m[1],
    { title: m[2].trim(), published: m[3] },
  ]),
);

const episodes = (await readdir(SRC, { withFileTypes: true }))
  .filter((d) => d.isDirectory() && /^ep\d+_/.test(d.name))
  .map((d) => d.name)
  .sort();
const index = [];
let totalBubbles = 0;
for (const ep of episodes) {
  const number = Number(ep.match(/^ep(\d+)/)[1]);
  const files = (await readdir(path.join(SRC, ep))).filter((f) => /^E\d+P\d+\.svg$/.test(f)).sort();
  const info = JSON.parse(await readFile(path.join(SRC, ep, 'info.json'), 'utf8').catch(() => '{}'));
  const pages = [];
  for (const f of files) {
    const page = f.replace('.svg', '');
    const bubbles = readingOrder(bubblesOf(await readFile(path.join(SRC, ep, f), 'utf8')));
    if (isCredits(bubbles.map((b) => b.text))) continue;
    pages.push({
      img: IMAGE(ep, page),
      b: bubbles.map((b) => ({ x: Math.round(b.x * 1000) / 1000, y: Math.round(b.y * 1000) / 1000, s: analyse(b.text, tokenizer, lookup, matchers) })),
    });
  }
  const bubbles = pages.reduce((n, p) => n + p.b.length, 0);
  totalBubbles += bubbles;
  const words = [...new Set(pages.flatMap((p) => p.b.flatMap((b) => b.s.w.map((w) => w[4] ?? -1))).filter((i) => i >= 0))].sort((a, b) => a - b);
  const meta = {
    id: ep,
    number,
    title: titles.get(ep)?.title ?? ep,
    published: titles.get(ep)?.published,
    credit: { art: 'David Revoy', translation: (info.credits?.translation ?? []).map((t) => t.replace(/\s*<[^>]*>/, '')) },
    pages: pages.length,
    bubbles,
  };
  index.push({ ...meta, words });
  await writeFile(path.join(outDir, `${ep}.json`), JSON.stringify({ ...meta, pages }));
}
await writeFile(path.join(outDir, 'index.json'), JSON.stringify(index));
console.log(`Pepper&Carrot: ${index.length} episodes, ${index.reduce((n, e) => n + e.pages, 0)} pages, ${totalBubbles} bubbles`);
const untitled = index.filter((e) => e.title === e.id).map((e) => e.id);
if (untitled.length) console.warn('No Japanese title found for:', untitled.join(' '));
