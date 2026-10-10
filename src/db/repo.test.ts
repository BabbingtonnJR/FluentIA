import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordsToApply } from '../sync/merge';
import { Rating } from '../srs/scheduler';
import { makePack } from '../test/fixtures';
import { FluentiaDB } from './db';
import { answerCard, buildSession, exportBackup, getSettings, importBackup, introducedToday, markLevelKnown, saveSettings, startCard } from './repo';
import { DEFAULT_SETTINGS } from './types';

let db: FluentiaDB;
const pack = makePack();

beforeEach(() => {
  db = new FluentiaDB(`test-${Math.random()}`);
});

afterEach(async () => {
  await db.delete();
});

describe('settings', () => {
  it('falls back to defaults and merges updates', async () => {
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS);
    await saveSettings({ newPerDay: 30 }, db);
    expect((await getSettings(db)).newPerDay).toBe(30);
    expect((await getSettings(db)).levels).toEqual(DEFAULT_SETTINGS.levels);
  });
});

describe('study session', () => {
  const settings = { ...DEFAULT_SETTINGS, levels: [5], newPerDay: 4, production: false };

  it('offers new cards up to the daily limit and counts what was learned', async () => {
    const now = Date.now();
    const first = await buildSession(pack, settings, now, db);
    expect(first.newCount).toBe(4);
    expect(first.dueCount).toBe(0);

    for (const entry of first.queue.slice(0, 3)) {
      if (entry.type !== 'new') throw new Error('expected new card');
      await answerCard(startCard(entry.ref, now), Rating.Good, 1000, now, db);
    }
    expect(await introducedToday('ja', settings, now, db)).toEqual({ recognition: 3, production: 0, grammar: 0 });

    const later = await buildSession(pack, settings, now + 60 * 60_000, db);
    expect(later.newCount).toBe(1);
    expect(later.dueCount).toBe(3); // learning cards are due again within the hour
  });

  it('does not count bulk "known" cards as learned today', async () => {
    const added = await markLevelKnown(pack, 5, Date.now(), db);
    expect(added).toBe(pack.vocab.filter((v) => v.level === 5).length + pack.kanji.filter((k) => k.level === 5).length);
    expect(await introducedToday('ja', settings, Date.now(), db)).toEqual({ recognition: 0, production: 0, grammar: 0 });
    const s = await buildSession(pack, settings, Date.now(), db);
    expect(s.newCount).toBe(0);
    expect(s.dueCount).toBe(0);
  });
});

describe('backup', () => {
  it('round-trips and keeps the newer record on import', async () => {
    const now = Date.now();
    const ref = { lang: 'ja', kind: 'vocab' as const, direction: 'recognition' as const, itemId: pack.vocab[0].id, level: 5 };
    const card = await answerCard(startCard(ref, now), Rating.Good, 0, now, db);
    const backup = await exportBackup(db);

    // Local card gets newer after the backup was taken.
    await answerCard(card, Rating.Easy, 0, now + 1000, db);
    await importBackup(backup, db);
    expect((await db.cards.get(card.id))!.updatedAt).toBe(now + 1000);

    const other = new FluentiaDB(`test-${Math.random()}`);
    expect(await importBackup(backup, other)).toBeGreaterThan(0);
    expect(await other.cards.count()).toBe(1);
    expect(await other.reviews.count()).toBe(1);
    await other.delete();
  });

  it('rejects files that are not backups', async () => {
    await expect(importBackup({ app: 'other' } as never, db)).rejects.toThrow();
  });
});

describe('sync merge', () => {
  it('applies remote records only when they are newer', () => {
    const remote = [
      { id: 'a', updatedAt: 5 },
      { id: 'b', updatedAt: 5 },
      { id: 'c', updatedAt: 5 },
    ];
    const local = [{ id: 'a', updatedAt: 9 }, { id: 'b', updatedAt: 1 }, undefined];
    expect(recordsToApply(remote, local).map((r) => r.id)).toEqual(['b', 'c']);
  });
});
