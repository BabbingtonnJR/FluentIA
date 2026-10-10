import { describe, expect, it } from 'vitest';
import { makePack } from '../test/fixtures';
import { buildQueue, productionLimit, selectNew } from './queue';
import { cardId, newCard } from './scheduler';

const pack = makePack();
const base = { pack, existing: new Set<string>(), graduatedVocab: new Set<string>(), introducedToday: { recognition: 0, production: 0 } };

describe('selectNew', () => {
  it('takes the easiest enabled level first and respects the daily limit', () => {
    const refs = selectNew({ ...base, settings: { levels: [4, 5], newPerDay: 5, production: false } });
    expect(refs).toHaveLength(5);
    expect(refs.every((r) => r.level === 5)).toBe(true);
  });

  it('mixes one kanji in every few words', () => {
    const refs = selectNew({ ...base, settings: { levels: [5], newPerDay: 10, production: false } });
    expect(refs.map((r) => r.kind)).toEqual(['kanji', 'vocab', 'vocab', 'vocab', 'vocab', 'kanji', 'vocab', 'vocab', 'vocab', 'vocab']);
  });

  it('subtracts cards already introduced today and skips existing cards', () => {
    const existing = new Set([cardId('ja', 'kanji', 'recognition', '一')]);
    const refs = selectNew({ ...base, existing, introducedToday: { recognition: 7, production: 0 }, settings: { levels: [5], newPerDay: 10, production: false } });
    expect(refs).toHaveLength(3);
    expect(refs.find((r) => r.itemId === '一')).toBeUndefined();
  });

  it('unlocks production cards only for graduated words, capped at half the daily limit', () => {
    const graduated = new Set(pack.vocab.slice(0, 8).map((v) => v.id));
    const refs = selectNew({ ...base, graduatedVocab: graduated, settings: { levels: [], newPerDay: 10, production: true } });
    expect(refs).toHaveLength(productionLimit(10));
    expect(refs.every((r) => r.direction === 'production' && graduated.has(r.itemId))).toBe(true);
  });

  it('returns nothing when the levels are exhausted', () => {
    const refs = selectNew({ ...base, settings: { levels: [], newPerDay: 10, production: false } });
    expect(refs).toEqual([]);
  });
});

describe('buildQueue', () => {
  it('spreads new cards evenly between reviews', () => {
    const now = Date.now();
    const due = Array.from({ length: 6 }, (_, i) => ({
      ...newCard({ lang: 'ja', kind: 'vocab', direction: 'recognition', itemId: `r${i}`, level: 5 }, now),
      due: now - i,
    }));
    const fresh = [1, 2].map((i) => ({ lang: 'ja', kind: 'vocab' as const, direction: 'recognition' as const, itemId: `n${i}`, level: 5 }));
    const q = buildQueue(due, fresh);
    expect(q.map((e) => e.type)).toEqual(['review', 'review', 'review', 'new', 'review', 'review', 'review', 'new']);
    // most overdue first
    expect(q[0]).toEqual({ type: 'review', cardId: due[5].id });
  });

  it('handles sessions with only new or only review cards', () => {
    const fresh = [{ lang: 'ja', kind: 'kanji' as const, direction: 'recognition' as const, itemId: '一', level: 5 }];
    expect(buildQueue([], fresh)).toEqual([{ type: 'new', ref: fresh[0] }]);
    expect(buildQueue([], [])).toEqual([]);
  });
});
