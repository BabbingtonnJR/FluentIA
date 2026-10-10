import type { Pack } from '../content/types';
import { dayKey, dayStart, uid } from '../lib/time';
import { knownCard, newCard, review, State, type CardRef, type Grade } from '../srs/scheduler';
import { buildQueue, selectNew, type QueueEntry } from '../srs/queue';
import { db, type FluentiaDB } from './db';
import { DEFAULT_SETTINGS, type ActivityRecord, type ActivityType, type CardRecord, type Settings } from './types';
import { notifyLocalChange } from '../sync/events';

const SETTINGS_KEY = 'settings';

export async function getSettings(d: FluentiaDB = db): Promise<Settings> {
  const rec = await d.kv.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...((rec?.value as Partial<Settings>) ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>, d: FluentiaDB = db): Promise<Settings> {
  const next = { ...(await getSettings(d)), ...patch };
  await d.kv.put({ id: SETTINGS_KEY, value: next, updatedAt: Date.now() });
  notifyLocalChange();
  return next;
}

export async function introducedToday(lang: string, settings: Settings, now = Date.now(), d: FluentiaDB = db) {
  const start = dayStart(now, settings.dayStartHour);
  const cards = await d.cards
    .where('[lang+createdAt]')
    .between([lang, start], [lang, Infinity])
    .toArray();
  // Cards marked as known in bulk are not "introduced"; they have reps but no review history today.
  const studied = new Set(
    (await d.reviews.where('[lang+reviewedAt]').between([lang, start], [lang, Infinity]).toArray())
      .filter((r) => r.prevState === State.New)
      .map((r) => r.cardId),
  );
  const out = { recognition: 0, production: 0, grammar: 0 };
  for (const c of cards) {
    if (!studied.has(c.id)) continue;
    if (c.kind === 'grammar') out.grammar++;
    else out[c.direction]++;
  }
  return out;
}

/** Builds today's study queue: due reviews plus the remaining new cards for today. */
export async function buildSession(pack: Pack, settings: Settings, now = Date.now(), d: FluentiaDB = db) {
  const lang = pack.manifest.id;
  const all = await d.cards.where('[lang+due]').between([lang, -Infinity], [lang, Infinity]).toArray();
  const due = all.filter((c) => c.due <= now);
  const existing = new Set(all.map((c) => c.id));
  const graduatedVocab = new Set(
    all
      .filter((c) => c.kind === 'vocab' && c.direction === 'recognition' && c.state === State.Review)
      .map((c) => c.itemId),
  );
  const fresh = selectNew({
    pack,
    settings,
    existing,
    graduatedVocab,
    introducedToday: await introducedToday(lang, settings, now, d),
  });
  const queue: QueueEntry[] = buildQueue(due, fresh);
  return { queue, dueCount: due.length, newCount: fresh.length };
}

export async function answerCard(
  card: CardRecord,
  grade: Grade,
  durationMs: number,
  now = Date.now(),
  d: FluentiaDB = db,
): Promise<CardRecord> {
  const { card: next, log } = review(card, grade, now, durationMs);
  await d.transaction('rw', d.cards, d.reviews, async () => {
    await d.cards.put(next);
    await d.reviews.put(log);
  });
  notifyLocalChange();
  return next;
}

export function startCard(ref: CardRef, now = Date.now()): CardRecord {
  return newCard(ref, now);
}

/** Marks every not-yet-studied item of a level as known (see knownCard). Returns how many were added. */
export async function markLevelKnown(pack: Pack, level: number, now = Date.now(), d: FluentiaDB = db): Promise<number> {
  const lang = pack.manifest.id;
  const existing = new Set((await d.cards.where('[lang+due]').between([lang, -Infinity], [lang, Infinity]).primaryKeys()) as string[]);
  const refs: CardRef[] = [
    ...pack.vocab.filter((v) => v.level === level).map((v) => ({ lang, kind: 'vocab' as const, direction: 'recognition' as const, itemId: v.id, level })),
    ...pack.kanji.filter((k) => k.level === level).map((k) => ({ lang, kind: 'kanji' as const, direction: 'recognition' as const, itemId: k.id, level })),
    ...pack.grammar.filter((g) => g.level === level).map((g) => ({ lang, kind: 'grammar' as const, direction: 'recognition' as const, itemId: g.id, level })),
  ];
  const cards = refs.map((r) => knownCard(r, now)).filter((c) => !existing.has(c.id));
  await d.cards.bulkPut(cards);
  notifyLocalChange();
  return cards.length;
}

export async function markItemKnown(ref: CardRef, now = Date.now(), d: FluentiaDB = db): Promise<CardRecord> {
  const card = knownCard(ref, now);
  await d.cards.put(card);
  notifyLocalChange();
  return card;
}

export async function logActivity(
  lang: string,
  type: ActivityType,
  data: { score?: number; total?: number; minutes?: number; detail?: ActivityRecord['detail'] },
  settings: Settings,
  now = Date.now(),
  d: FluentiaDB = db,
): Promise<ActivityRecord> {
  const rec: ActivityRecord = {
    id: uid(),
    lang,
    type,
    day: dayKey(now, settings.dayStartHour),
    score: data.score ?? 0,
    total: data.total ?? 0,
    minutes: data.minutes ?? 0,
    ...(data.detail ? { detail: data.detail } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await d.activities.put(rec);
  notifyLocalChange();
  return rec;
}

/** Full local backup, used for export/import. */
export async function exportBackup(d: FluentiaDB = db) {
  return {
    app: 'fluentia',
    version: 1,
    exportedAt: new Date().toISOString(),
    cards: await d.cards.toArray(),
    reviews: await d.reviews.toArray(),
    activities: await d.activities.toArray(),
    kv: await d.kv.toArray(),
  };
}

export type Backup = Awaited<ReturnType<typeof exportBackup>>;

/** Merges a backup into the local database; newer records win. */
export async function importBackup(backup: Backup, d: FluentiaDB = db): Promise<number> {
  if (backup.app !== 'fluentia') throw new Error('This file is not a Fluentia backup.');
  let count = 0;
  await d.transaction('rw', [d.cards, d.reviews, d.activities, d.kv], async () => {
    for (const name of ['cards', 'reviews', 'activities', 'kv'] as const) {
      const table = d.table(name);
      for (const rec of backup[name] as { id: string; updatedAt: number }[]) {
        const local = (await table.get(rec.id)) as { updatedAt: number } | undefined;
        if (!local || local.updatedAt < rec.updatedAt) {
          await table.put(rec);
          count++;
        }
      }
    }
  });
  notifyLocalChange();
  return count;
}
