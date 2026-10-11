/** A page as mokuro describes it: the image it belongs to and its text blocks in pixels. */
export interface MokuroPage {
  imgPath: string;
  width: number;
  height: number;
  blocks: { box: [number, number, number, number]; text: string }[];
}

export interface MokuroVolume {
  title: string;
  pages: MokuroPage[];
}

interface RawBlock {
  box?: number[];
  lines?: string[];
}
interface RawPage {
  img_path?: string;
  img_width?: number;
  img_height?: number;
  blocks?: RawBlock[];
}

/** Rows of bubbles closer than this (share of page height) are read as one row. */
const ROW = 0.08;

/**
 * Manga reading order: top to bottom by rows, and right to left within a row. Good enough for
 * stepping through bubbles; the page image shows the real layout.
 */
export function mangaOrder<T extends { box: [number, number, number, number] }>(blocks: T[], height: number): T[] {
  const row = (b: T) => Math.round(b.box[1] / height / ROW);
  return [...blocks].sort((a, b) => row(a) - row(b) || b.box[2] - a.box[2]);
}

type Box = [number, number, number, number];

/** Overlap of two boxes as a share of the smaller one. */
function overlap(a: Box, b: Box): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const area = (x: Box) => (x[2] - x[0]) * (x[3] - x[1]);
  return (w * h) / Math.min(area(a), area(b));
}

/**
 * OCR text as plain Japanese: full-width digits, letters and punctuation (８, Ｋｏ, ．．．) become
 * ordinary ones, as in the rest of the app.
 */
const normalise = (s: string) => s.normalize('NFKC').replace(/\.{3,}/g, '…').trim();

/** Reads a .mokuro file (mokuro 0.2+): the volume's pages, each block's box and its lines of text. */
export function parseMokuro(json: string): MokuroVolume {
  const data = JSON.parse(json) as { title?: string; volume?: string; pages?: RawPage[] };
  if (!Array.isArray(data.pages)) throw new Error('This does not look like a mokuro file (no pages).');
  const title = [data.title, data.volume].filter(Boolean).join(' ');
  const pages = data.pages.map((p): MokuroPage => {
    const width = p.img_width ?? 1;
    const height = p.img_height ?? 1;
    const blocks: { box: Box; text: string }[] = [];
    for (const b of p.blocks ?? []) {
      if (!Array.isArray(b.box) || b.box.length !== 4 || !b.lines?.length) continue;
      const block = { box: b.box as Box, text: normalise(b.lines.join('')) };
      if (!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(block.text)) continue;
      // The detector sometimes finds the same bubble twice; keep the later reading.
      const twin = blocks.findIndex((x) => overlap(x.box, block.box) > 0.8);
      if (twin >= 0) blocks[twin] = block;
      else blocks.push(block);
    }
    return { imgPath: p.img_path ?? '', width, height, blocks: mangaOrder(blocks, height) };
  });
  return { title, pages };
}

/** File name without folders, for matching mokuro's img_path to files in a zip. */
export const baseName = (path: string) => path.split(/[\\/]/).pop()!.toLowerCase();

export const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
};
