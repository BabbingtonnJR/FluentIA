import { describe, expect, it } from 'vitest';
import { DAY } from '../lib/time';
import { isMature, knownCard, newCard, previewIntervals, Rating, review, State } from './scheduler';

const ref = { lang: 'ja', kind: 'vocab' as const, direction: 'recognition' as const, itemId: '水|みず', level: 5 };

describe('scheduler', () => {
  it('moves a new card into learning and logs the review', () => {
    const now = Date.UTC(2026, 9, 10, 12);
    const { card, log } = review(newCard(ref, now), Rating.Good, now, 3000);
    expect(card.state).toBe(State.Learning);
    expect(card.due).toBeGreaterThan(now);
    expect(card.reps).toBe(1);
    expect(log).toMatchObject({ cardId: card.id, rating: Rating.Good, prevState: State.New, durationMs: 3000 });
  });

  it('gives longer intervals for easier answers', () => {
    const now = Date.UTC(2026, 9, 10, 12);
    const p = previewIntervals(newCard(ref, now), now);
    expect(p[Rating.Again]).toBeLessThanOrEqual(p[Rating.Hard]);
    expect(p[Rating.Hard]).toBeLessThanOrEqual(p[Rating.Good]);
    expect(p[Rating.Good]).toBeLessThan(p[Rating.Easy]);
  });

  it('round-trips through FSRS without losing state', () => {
    let now = Date.UTC(2026, 9, 10, 12);
    let card = newCard(ref, now);
    for (let i = 0; i < 4; i++) {
      card = review(card, Rating.Good, now).card;
      now = card.due;
    }
    expect(card.state).toBe(State.Review);
    expect(card.lastReview).not.toBeNull();
    expect(card.scheduledDays).toBeGreaterThan(1);
  });

  it('marks known cards as reviews spread over the requested window', () => {
    const now = Date.UTC(2026, 9, 10, 12);
    const low = knownCard(ref, now, 20, 90, () => 0);
    const high = knownCard(ref, now, 20, 90, () => 1);
    expect(low.state).toBe(State.Review);
    expect(low.due).toBe(now + 20 * DAY);
    expect(high.due).toBe(now + 90 * DAY);
    expect(isMature(low)).toBe(false);
    expect(isMature(high)).toBe(true);
  });
});
