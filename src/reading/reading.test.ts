import { describe, expect, it } from 'vitest';
import type { Sentence } from '../content/types';
import { parseRuby, plainText, showRuby } from './furigana';
import { MIN_KNOWN_WORDS, pickReading, unknownWords } from './select';

describe('parseRuby', () => {
  it('splits per-kanji readings when every kanji has one', () => {
    expect(parseRuby('[場所|ば|しょ]とか')).toEqual([{ text: '場', ruby: 'ば' }, { text: '所', ruby: 'しょ' }, { text: 'とか' }]);
  });

  it('keeps one reading for the whole word when counts differ', () => {
    expect(parseRuby('[今日|きょう]は[暑|あつ]い')).toEqual([
      { text: '今日', ruby: 'きょう' },
      { text: 'は' },
      { text: '暑', ruby: 'あつ' },
      { text: 'い' },
    ]);
  });

  it('returns plain text unchanged', () => {
    expect(parseRuby('ありがとう。')).toEqual([{ text: 'ありがとう。' }]);
    expect(plainText('[私|わたし]は[学生|がく|せい]です。')).toBe('私は学生です。');
  });
});

describe('showRuby', () => {
  const known = new Set(['私']);
  it('respects the furigana mode', () => {
    expect(showRuby({ text: '私', ruby: 'わたし' }, 'all', known)).toBe(true);
    expect(showRuby({ text: '私', ruby: 'わたし' }, 'none', known)).toBe(false);
    expect(showRuby({ text: '私', ruby: 'わたし' }, 'unknown', known)).toBe(false);
    expect(showRuby({ text: '学生', ruby: 'がくせい' }, 'unknown', known)).toBe(true);
    expect(showRuby({ text: 'は' }, 'all', known)).toBe(false);
  });
});

describe('pickReading', () => {
  // Sentence n uses words [n, n+1]; plus a few that use a word nobody knows (999).
  const sentences: Sentence[] = [
    ...Array.from({ length: 200 }, (_, n) => ({ i: n, r: `文${n}`, e: `s${n}`, w: [n, n + 1], l: n < 100 ? 5 : 4 })),
    ...Array.from({ length: 20 }, (_, n) => ({ i: 1000 + n, r: `難${n}`, e: `h${n}`, w: [998, 999], l: 3 })),
  ];
  const known = new Set(Array.from({ length: 60 }, (_, n) => n)); // words 0–59

  it('is deterministic for a seed and varies across seeds', () => {
    const a = pickReading(sentences, known, '2026-10-10#0');
    expect(pickReading(sentences, known, '2026-10-10#0')).toEqual(a);
    expect(pickReading(sentences, known, '2026-10-11#0')).not.toEqual(a);
  });

  it('uses known words, with some sentences adding exactly one new word', () => {
    const picked = pickReading(sentences, known, 'seed', 8);
    expect(picked).toHaveLength(8);
    const unknownCounts = picked.map((s) => unknownWords(s, known).length);
    expect(Math.max(...unknownCounts)).toBeLessThanOrEqual(1);
    expect(unknownCounts.filter((n) => n === 1)).toHaveLength(1); // only sentence 59 → [59, 60] stretches
  });

  it('never repeats excluded sentences', () => {
    const first = pickReading(sentences, known, 'seed', 8);
    const second = pickReading(sentences, known, 'seed#1', 8, new Set(first.map((s) => s.i)));
    expect(second.some((s) => first.includes(s))).toBe(false);
  });

  it('starts beginners on easy N5 sentences', () => {
    const few = new Set(Array.from({ length: MIN_KNOWN_WORDS - 1 }, (_, n) => n));
    const picked = pickReading(sentences, few, 'seed', 8);
    expect(picked).toHaveLength(8);
    expect(picked.every((s) => s.l === 5)).toBe(true);
  });
});
