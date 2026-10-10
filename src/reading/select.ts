import type { Sentence } from '../content/types';

/** FNV-1a hash → mulberry32, so the same day always gives the same reading on every device. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const unknownWords = (s: Sentence, known: ReadonlySet<number>) => s.w.filter((w) => !known.has(w));

/** Below this many studied words there is too little to build on, so readings start from easy N5 sentences. */
export const MIN_KNOWN_WORDS = 30;
/** Share of each reading that introduces exactly one new word (comprehensible input, "i+1"). */
const STRETCH_SHARE = 0.4;

/**
 * Picks a short reading from sentences built from words the learner has studied: most use
 * only known words, some add one new word. Deterministic per seed (the study day plus a
 * batch number for "more sentences"); sentences in `exclude` are never repeated.
 */
export function pickReading(
  sentences: Sentence[],
  known: ReadonlySet<number>,
  seed: string,
  count = 8,
  exclude: ReadonlySet<number> = new Set(),
): Sentence[] {
  const rand = seededRandom(seed);
  const pool = sentences.filter((s) => !exclude.has(s.i));

  if (known.size < MIN_KNOWN_WORDS) {
    const easy = pool.filter((s) => s.l === 5).sort((a, b) => a.w.length - b.w.length || a.r.length - b.r.length);
    return shuffle(easy.slice(0, 400), rand).slice(0, count);
  }

  const familiar: Sentence[] = [];
  const stretch: Sentence[] = [];
  for (const s of pool) {
    const n = unknownWords(s, known).length;
    if (n === 0 && s.w.length >= 2) familiar.push(s);
    else if (n === 1) stretch.push(s);
  }

  const wantStretch = Math.min(Math.round(count * STRETCH_SHARE), stretch.length);
  const picked = [...shuffle(familiar, rand).slice(0, count - wantStretch), ...shuffle(stretch, rand).slice(0, wantStretch)];
  if (picked.length < count) {
    // Not enough familiar material yet: top up with the sentences that need the fewest new words.
    const chosen = new Set(picked);
    const rest = pool
      .filter((s) => !chosen.has(s))
      .map((s) => ({ s, n: unknownWords(s, known).length, r: rand() }))
      .sort((a, b) => a.n - b.n || a.r - b.r)
      .slice(0, count - picked.length)
      .map((x) => x.s);
    picked.push(...rest);
  }
  return shuffle(picked, rand);
}
