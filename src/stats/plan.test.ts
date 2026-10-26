import { describe, expect, it } from 'vitest';
import type { ReviewRecord } from '../db/types';
import { DAY } from '../lib/time';
import { knownCard, State } from '../srs/scheduler';
import { makePack } from '../test/fixtures';
import { examPlan, nextJlptDate } from './plan';

describe('next JLPT date', () => {
  it('is the first Sunday of July or December', () => {
    expect(nextJlptDate(new Date(2026, 9, 26))).toBe('2026-12-06');
    expect(nextJlptDate(new Date(2026, 11, 6))).toBe('2026-12-06');
    expect(nextJlptDate(new Date(2026, 11, 7))).toBe('2027-07-04');
    expect(nextJlptDate(new Date(2027, 0, 10))).toBe('2027-07-04');
  });
});

describe('exam plan', () => {
  const pack = makePack({ 5: 10, 4: 10 }, { 5: 4, 4: 4 }, { 4: 6 });
  const lang = pack.manifest.id;
  const now = new Date(2026, 9, 26, 12).getTime();

  it('covers the level and the easier ones, and spreads what is left over the days before the review week', () => {
    const seen = pack.vocab.slice(0, 5).map((v) => knownCard({ lang, kind: 'vocab', direction: 'recognition', itemId: v.id, level: v.level }, now));
    const plan = examPlan(pack, seen, [], 4, '2026-12-06', now);
    expect(plan.daysLeft).toBe(41);
    expect(plan.words).toEqual({ total: 20, seen: 5 });
    expect(plan.kanji).toEqual({ total: 8, seen: 0 });
    expect(plan.grammar).toEqual({ total: 6, seen: 0 });
    // 23 words and kanji over 34 days → 1 a day; 6 grammar points → 1 a day.
    expect(plan.wordsPerDay).toBe(1);
    expect(plan.grammarPerDay).toBe(1);
    expect(plan.finishAt).toBeNull();
  });

  it('only counts the exam level and above for N5', () => {
    const plan = examPlan(pack, [], [], 5, '2026-12-06', now);
    expect(plan.words.total).toBe(10);
    expect(plan.grammar.total).toBe(0);
  });

  it('projects the finish from the last two weeks of new cards', () => {
    const reviews = Array.from({ length: 28 }, (_, i): ReviewRecord => ({ id: `r${i}`, cardId: `c${i}`, lang, rating: 3, prevState: State.New, reviewedAt: now - i * 3600_000, durationMs: 0, updatedAt: 0 }));
    const plan = examPlan(pack, [], reviews, 4, '2026-12-06', now);
    expect(plan.pace).toBe(2);
    // 34 items left at 2 a day → 17 days.
    expect(plan.finishAt).toBe(now + 17 * DAY);
  });
});
