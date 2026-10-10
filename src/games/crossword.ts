import type { Pack, VocabItem } from '../content/types';
import { puzzleKana, tiles } from './wordle';

export type Direction = 'across' | 'down';

export interface PlacedWord {
  number: number;
  dir: Direction;
  row: number;
  col: number;
  /** The answer as kana tiles. */
  kana: string[];
  item: VocabItem;
}

export interface Crossword {
  width: number;
  height: number;
  /** Answer kana per cell, null for blocks. */
  cells: (string | null)[][];
  words: PlacedWord[];
}

type Rand = () => number;

/** Largest side, so the grid stays readable on a phone. */
export const GRID_MAX = 9;
const MIN_LEN = 2;
const MAX_LEN = 6;

const key = (r: number, c: number) => `${r},${c}`;
const step = (dir: Direction) => (dir === 'across' ? [0, 1] : [1, 0]);

function shuffle<T>(arr: T[], rand: Rand): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface Candidate {
  kana: string[];
  item: VocabItem;
}

/** Words of one level that fit a crossword: one reading, 2–6 kana, distinct readings and clues. */
export function crosswordWords(pack: Pack, level: number): Candidate[] {
  const seen = new Set<string>();
  const clues = new Set<string>();
  const out: Candidate[] = [];
  for (const item of pack.vocab) {
    if (item.level !== level) continue;
    const kana = puzzleKana(item);
    if (!kana) continue;
    const t = tiles(kana);
    if (t.length < MIN_LEN || t.length > MAX_LEN || seen.has(kana) || clues.has(item.meaning)) continue;
    seen.add(kana);
    clues.add(item.meaning);
    out.push({ kana: t, item });
  }
  return out;
}

interface Spot {
  row: number;
  col: number;
  dir: Direction;
}
interface Bounds {
  minR: number;
  maxR: number;
  minC: number;
  maxC: number;
}

/**
 * Builds a crossword the classic greedy way: the first word goes across, then each word is placed
 * where it crosses the grid on a shared kana, never running alongside another word (so every run
 * of two or more kana in the grid is a real answer). Several attempts are made and the fullest,
 * most compact grid wins.
 */
export function generateCrossword(candidates: Candidate[], rand: Rand, target = 8, attempts = 24): Crossword | null {
  type Draft = Omit<PlacedWord, 'number'>;
  let best: { grid: Map<string, string>; words: Draft[]; bounds: Bounds; score: number } | null = null;

  for (let a = 0; a < attempts; a++) {
    const pool = shuffle(candidates, rand).slice(0, 200);
    // A longer first word makes a better spine for the rest to hang on.
    const first = pool.find((c) => c.kana.length >= 4) ?? pool[0];
    if (!first) return null;
    const grid = new Map<string, string>();
    const words: Draft[] = [];
    const bounds: Bounds = { minR: 0, maxR: 0, minC: 0, maxC: 0 };
    const put = (c: Candidate, s: Spot) => {
      const [dr, dc] = step(s.dir);
      c.kana.forEach((k, i) => {
        const r = s.row + dr * i;
        const col = s.col + dc * i;
        grid.set(key(r, col), k);
        bounds.minR = Math.min(bounds.minR, r);
        bounds.maxR = Math.max(bounds.maxR, r);
        bounds.minC = Math.min(bounds.minC, col);
        bounds.maxC = Math.max(bounds.maxC, col);
      });
      words.push({ ...s, kana: c.kana, item: c.item });
    };
    put(first, { row: 0, col: 0, dir: 'across' });
    const used = new Set([first.kana.join('')]);

    for (const cand of pool) {
      if (words.length >= target) break;
      if (used.has(cand.kana.join(''))) continue;
      const options = spots(grid, cand.kana, bounds);
      if (!options.length) continue;
      const most = Math.max(...options.map((o) => o.crossings));
      put(cand, shuffle(options.filter((o) => o.crossings === most), rand)[0]);
      used.add(cand.kana.join(''));
    }

    const area = (bounds.maxR - bounds.minR + 1) * (bounds.maxC - bounds.minC + 1);
    const score = words.length * 100 + (grid.size / area) * 50;
    if (!best || score > best.score) best = { grid, words, bounds: { ...bounds }, score };
    if (words.length >= target) break;
  }
  if (!best) return null;

  // Shift to 0-based coordinates.
  const { minR, minC } = best.bounds;
  const height = best.bounds.maxR - minR + 1;
  const width = best.bounds.maxC - minC + 1;
  const cells = Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => best.grid.get(key(r + minR, c + minC)) ?? null));
  const drafts = best.words.map((w) => ({ ...w, row: w.row - minR, col: w.col - minC }));

  // Number the starting cells in reading order, as printed crosswords do.
  const starts = [...new Set(drafts.map((w) => w.row * GRID_MAX * 4 + w.col))].sort((x, y) => x - y);
  const words = drafts
    .map((w) => ({ ...w, number: starts.indexOf(w.row * GRID_MAX * 4 + w.col) + 1 }))
    .sort((x, y) => (x.dir === y.dir ? x.number - y.number : x.dir === 'across' ? -1 : 1));
  return { width, height, cells, words };
}

/** Every legal spot for a word: crossing at least one matching kana and touching nothing else. */
function spots(grid: Map<string, string>, kana: string[], b: Bounds): (Spot & { crossings: number })[] {
  const out: (Spot & { crossings: number })[] = [];
  const seen = new Set<string>();
  for (const [k, v] of grid) {
    const [r0, c0] = k.split(',').map(Number);
    kana.forEach((ch, i) => {
      if (ch !== v) return;
      for (const dir of ['across', 'down'] as const) {
        const [dr, dc] = step(dir);
        const row = r0 - dr * i;
        const col = c0 - dc * i;
        const id = `${row},${col},${dir}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const crossings = fits(grid, kana, { row, col, dir });
        if (crossings <= 0) continue;
        const h = Math.max(b.maxR, row + dr * (kana.length - 1)) - Math.min(b.minR, row) + 1;
        const w = Math.max(b.maxC, col + dc * (kana.length - 1)) - Math.min(b.minC, col) + 1;
        if (h > GRID_MAX || w > GRID_MAX) continue;
        out.push({ row, col, dir, crossings });
      }
    });
  }
  return out;
}

/** How many kana the word would share with the grid at this spot, or -1 if it clashes or touches another word. */
function fits(grid: Map<string, string>, kana: string[], { row, col, dir }: Spot): number {
  const [dr, dc] = step(dir);
  // The cells just before and after must be empty, or the word would run into another one.
  if (grid.has(key(row - dr, col - dc)) || grid.has(key(row + dr * kana.length, col + dc * kana.length))) return -1;
  let crossings = 0;
  for (let i = 0; i < kana.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    const existing = grid.get(key(r, c));
    if (existing !== undefined) {
      if (existing !== kana[i]) return -1;
      crossings++;
      continue;
    }
    // A new cell may not sit beside another kana, which would make a stray two-kana word.
    if (grid.has(key(r + dc, c + dr)) || grid.has(key(r - dc, c - dr))) return -1;
  }
  // Sharing every cell would mean lying on top of a word already there.
  return crossings === kana.length ? -1 : crossings;
}

/** Every run of two or more kana in the grid, across then down: each must be an answer. */
export function gridRuns(cw: Crossword): string[] {
  const runs: string[] = [];
  const scan = (get: (i: number, j: number) => string | null, n: number, m: number) => {
    for (let i = 0; i < n; i++) {
      let run: string[] = [];
      for (let j = 0; j <= m; j++) {
        const ch = j < m ? get(i, j) : null;
        if (ch) run.push(ch);
        else {
          if (run.length >= 2) runs.push(run.join(''));
          run = [];
        }
      }
    }
  };
  scan((r, c) => cw.cells[r][c], cw.height, cw.width);
  scan((c, r) => cw.cells[r][c], cw.width, cw.height);
  return runs;
}

/** Cells of a word, in order. */
export function wordCells(w: Pick<PlacedWord, 'row' | 'col' | 'dir' | 'kana'>): [number, number][] {
  const [dr, dc] = step(w.dir);
  return w.kana.map((_, i) => [w.row + dr * i, w.col + dc * i]);
}

/** Score for XP: two points per word, minus one per revealed kana (never below zero). */
export function crosswordScore(words: number, revealed: number): number {
  return Math.max(0, words * 2 - revealed);
}

/** A short clue from a word-list gloss: the first sense, without examples. */
export function clueText(meaning: string): string {
  const first = meaning.split(';')[0].replace(/\s*\((e\.g\.|lit|see)[^)]*\)/gi, '').trim();
  return first || meaning;
}
