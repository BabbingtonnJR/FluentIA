import { describe, expect, it } from 'vitest';
import type { ReviewRecord } from '../db/types';
import { dayKey, shiftDay } from '../lib/time';
import { newCard, Rating, State, type Grade } from '../srs/scheduler';
import { makePack } from '../test/fixtures';
import { computeStreak, forecast, levelBreakdown, levelFromXp, retention, reviewsPerDay } from './stats';

describe('time helpers', () => {
  it('counts late-night study for the previous day', () => {
    const lateNight = new Date(2026, 9, 11, 2, 30).getTime();
    expect(dayKey(lateNight, 4)).toBe('2026-10-10');
    expect(dayKey(lateNight, 0)).toBe('2026-10-11');
  });

  it('shifts day keys across month boundaries', () => {
    expect(shiftDay('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('computeStreak', () => {
  const days = new Set(['2026-10-05', '2026-10-06', '2026-10-08', '2026-10-09', '2026-10-10']);

  it('counts consecutive days ending today', () => {
    expect(computeStreak(days, '2026-10-10')).toEqual({ current: 3, best: 3, doneToday: true });
  });

  it('keeps the streak alive until today is over', () => {
    expect(computeStreak(days, '2026-10-11')).toEqual({ current: 3, best: 3, doneToday: false });
  });

  it('resets after a missed day', () => {
    expect(computeStreak(days, '2026-10-12').current).toBe(0);
  });
});

describe('levelFromXp', () => {
  it('starts at level 1 and grows quadratically', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, into: 0, needed: 50 });
    expect(levelFromXp(50).level).toBe(2);
    expect(levelFromXp(199).level).toBe(2);
    expect(levelFromXp(200).level).toBe(3);
  });
});

function log(reviewedAt: number, prevState: State, rating: Grade = Rating.Good): ReviewRecord {
  return { id: String(Math.random()), cardId: 'c', lang: 'ja', rating, prevState, reviewedAt, durationMs: 0, updatedAt: reviewedAt };
}

describe('daily aggregates', () => {
  const now = new Date(2026, 9, 10, 12).getTime();
  const today = dayKey(now);

  it('splits learned cards from reviews per day', () => {
    const reviews = [log(now, State.New), log(now, State.Review), log(now - 86_400_000, State.Review)];
    const days = reviewsPerDay(reviews, today, 3, 4);
    expect(days.map((d) => d.day)).toEqual([shiftDay(today, -2), shiftDay(today, -1), today]);
    expect(days[2]).toMatchObject({ reviews: 1, learned: 1 });
    expect(days[1]).toMatchObject({ reviews: 1, learned: 0 });
  });

  it('puts overdue cards in today’s forecast', () => {
    const card = (due: number) => ({ ...newCard({ lang: 'ja', kind: 'vocab', direction: 'recognition', itemId: 'x', level: 5 }, now), due });
    const f = forecast([card(now - 5 * 86_400_000), card(now), card(now + 86_400_000)], today, 3, 4);
    expect(f.map((d) => d.due)).toEqual([2, 1, 0]);
  });

  it('computes retention from review-state cards only', () => {
    expect(retention([log(now, State.New, Rating.Again)])).toBeNull();
    expect(retention([log(now, State.Review), log(now, State.Review, Rating.Again), log(now, State.Learning, Rating.Again)])).toBe(0.5);
  });
});

describe('levelBreakdown', () => {
  it('classifies each item by its recognition card', () => {
    const pack = makePack({ 5: 2, 4: 0 }, { 5: 1, 4: 0 });
    const now = Date.now();
    const learning = { ...newCard({ lang: 'ja', kind: 'vocab', direction: 'recognition', itemId: pack.vocab[0].id, level: 5 }, now), state: State.Learning };
    const mature = { ...newCard({ lang: 'ja', kind: 'kanji', direction: 'recognition', itemId: pack.kanji[0].id, level: 5 }, now), state: State.Review, stability: 30 };
    const [n5] = levelBreakdown(pack, [learning, mature]);
    expect(n5).toMatchObject({ total: 3, unseen: 1, learning: 1, young: 0, mature: 1 });
  });
});
