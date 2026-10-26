import { describe, expect, it } from 'vitest';
import type { ActivityRecord } from '../db/types';
import { knownCard } from '../srs/scheduler';
import { stamps, treeStage } from './stamps';

const activity = (type: ActivityRecord['type'], extra: Partial<ActivityRecord> = {}): ActivityRecord => ({
  id: Math.random().toString(),
  lang: 'ja',
  type,
  day: '2026-10-26',
  score: 1,
  total: 1,
  minutes: 1,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

describe('stamp book', () => {
  it('earns stamps from what was done, and shows progress on the rest', () => {
    const words = Array.from({ length: 120 }, (_, i) => knownCard({ lang: 'ja', kind: 'vocab', direction: 'recognition', itemId: `w${i}`, level: 5 }, 0));
    const list = stamps({
      cards: words,
      activities: [
        activity('roleplay'),
        activity('mock', { score: 26, total: 30, detail: { level: 4, sections: { vocab: [9, 10], grammar: [8, 10], reading: [4, 5], listening: [5, 5] } } }),
      ],
      mistakes: [],
      reviews: 10,
      bestStreak: 8,
    });
    const get = (id: string) => list.find((s) => s.id === id)!;
    expect(get('first').earned).toBe(true);
    expect(get('week').earned).toBe(true);
    expect(get('words100').earned).toBe(true);
    expect(get('speak').earned).toBe(true);
    expect(get('n4').earned).toBe(true);
    expect(get('n3').earned).toBe(false);
    expect(get('month')).toMatchObject({ earned: false, progress: [8, 30] });
    expect(get('words1000').progress).toEqual([120, 1000]);
  });

  it('grows the tree with the level', () => {
    expect(treeStage(1)).toBe(0);
    expect(treeStage(3)).toBe(1);
    expect(treeStage(9)).toBe(2);
    expect(treeStage(25)).toBe(5);
  });
});
