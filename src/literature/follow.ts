import type { LitBlock } from '../content/types';

/**
 * LibriVox chapters open with a spoken notice ("これはLibriVoxの録音です…") and close with the
 * chapter's end; these are rough lengths, so following along is an estimate.
 */
export const LEAD_SECONDS = 12;
export const TAIL_SECONDS = 4;

export interface Chapter {
  /** Index of its first sentence, counting all sentences of the work. */
  first: number;
  /** Characters read before each of its sentences, and the chapter's total at the end. */
  offsets: number[];
}

const length = (w: [string, ...unknown[]][]) => w.reduce((n, x) => n + x[0].length, 0);

/** Splits a work into chapters at its headings, as the audio is split. */
export function chapters(body: LitBlock[]): Chapter[] {
  const out: Chapter[] = [];
  let index = 0;
  let current: Chapter | null = null;
  for (const block of body) {
    if ('h' in block) {
      current = { first: index, offsets: [0] };
      out.push(current);
      continue;
    }
    for (const s of block.s) {
      if (!current) {
        current = { first: index, offsets: [0] };
        out.push(current);
      }
      current.offsets.push(current.offsets.at(-1)! + length(s.w));
      index++;
    }
  }
  return out;
}

/** The share of the chapter's speech reached at `time`, between 0 and 1. */
function share(time: number, duration: number): number {
  const spoken = duration - LEAD_SECONDS - TAIL_SECONDS;
  if (spoken <= 0) return 0;
  return Math.min(1, Math.max(0, (time - LEAD_SECONDS) / spoken));
}

/** The sentence (work-wide index) being read at `time`, assuming a steady reading pace. */
export function sentenceAt(ch: Chapter, time: number, duration: number): number {
  const total = ch.offsets.at(-1)!;
  const target = share(time, duration) * total;
  let i = 0;
  while (i < ch.offsets.length - 2 && ch.offsets[i + 1] <= target) i++;
  return ch.first + i;
}

/** Where in the chapter's audio a sentence (work-wide index) starts. */
export function timeOf(ch: Chapter, sentence: number, duration: number): number {
  const total = ch.offsets.at(-1)! || 1;
  const at = ch.offsets[Math.min(Math.max(sentence - ch.first, 0), ch.offsets.length - 1)];
  return LEAD_SECONDS + (at / total) * (duration - LEAD_SECONDS - TAIL_SECONDS);
}

/** The chapter (index) that holds a sentence. */
export function chapterOf(list: Chapter[], sentence: number): number {
  let c = 0;
  while (c + 1 < list.length && list[c + 1].first <= sentence) c++;
  return c;
}
