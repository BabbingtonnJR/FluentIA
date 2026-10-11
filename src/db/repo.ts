import type { Pack } from '../content/types';
import { dayKey, dayStart, uid } from '../lib/time';
import { cardId, knownCard, newCard, review, State, type CardRef, type Grade } from '../srs/scheduler';
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
    // Imported decks have their own daily budget (see customNew).
    if (!studied.has(c.id) || c.kind === 'custom') continue;
    if (c.kind === 'grammar') out.grammar++;
    else out[c.direction]++;
  }
  return out;
}

/** Builds today's study queue: due reviews plus the remaining new cards for today. */
export async function buildSession(pack: Pack, settings: Settings, now = Date.now(), d: FluentiaDB = db) {
  const lang = pack.manifest.id;
  const stored = await d.cards.where('[lang+due]').between([lang, -Infinity], [lang, Infinity]).toArray();
  const all = stored.filter((c) => !c.deleted);
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
  const graduatedNotes = new Set(
    all.filter((c) => c.kind === 'custom' && c.direction === 'recognition' && c.state === State.Review).map((c) => c.itemId),
  );
  fresh.push(...(await customNew(lang, existing, graduatedNotes, settings, now, d)));
  const queue: QueueEntry[] = buildQueue(due, fresh);
  return { queue, dueCount: due.length, newCount: fresh.length };
}

/**
 * New cards from imported decks: each deck's notes in order, up to its own daily limit. A note
 * the deck also asks the other way round gets that card once its front → back card is learnt.
 */
async function customNew(
  lang: string,
  existing: Set<string>,
  graduatedNotes: Set<string>,
  settings: Settings,
  now: number,
  d: FluentiaDB,
): Promise<CardRef[]> {
  const decks = (await d.decks.where('lang').equals(lang).toArray()).filter((k) => !k.deleted);
  if (!decks.length) return [];
  const prefix = `${lang}:custom:`;
  const firstToday = (await d.reviews.where('[lang+reviewedAt]').between([lang, dayStart(now, settings.dayStartHour)], [lang, Infinity]).toArray())
    .filter((r) => r.prevState === State.New && r.cardId.startsWith(prefix))
    .map((r) => r.cardId.slice(r.cardId.indexOf(':', prefix.length) + 1));
  const introduced = new Map<string, number>();
  for (const note of await d.notes.bulkGet(firstToday)) if (note) introduced.set(note.deckId, (introduced.get(note.deckId) ?? 0) + 1);

  const out: CardRef[] = [];
  for (const deck of decks) {
    let left = deck.newPerDay - (introduced.get(deck.id) ?? 0);
    if (left <= 0) continue;
    const notes = (await d.notes.where('deckId').equals(deck.id).sortBy('order')).filter((n) => !n.deleted);
    const ref = (n: { id: string }, direction: 'recognition' | 'production'): CardRef => ({ lang, kind: 'custom', direction, itemId: n.id, level: 0 });
    for (const n of notes) {
      if (left === 0) break;
      if (existing.has(cardId(lang, 'custom', 'recognition', n.id))) continue;
      out.push(ref(n, 'recognition'));
      left--;
    }
    for (const n of notes) {
      if (left === 0) break;
      if (!n.reverse || !graduatedNotes.has(n.id) || existing.has(cardId(lang, 'custom', 'production', n.id))) continue;
      out.push(ref(n, 'production'));
      left--;
    }
  }
  return out;
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
    decks: await d.decks.toArray(),
    notes: await d.notes.toArray(),
  };
}

export type Backup = Awaited<ReturnType<typeof exportBackup>>;

/** Merges a backup into the local database; newer records win. */
export async function importBackup(backup: Backup, d: FluentiaDB = db): Promise<number> {
  if (backup.app !== 'fluentia') throw new Error('This file is not a Fluentia backup.');
  let count = 0;
  await d.transaction('rw', [d.cards, d.reviews, d.activities, d.kv, d.decks, d.notes], async () => {
    for (const name of ['cards', 'reviews', 'activities', 'kv', 'decks', 'notes'] as const) {
      const table = d.table(name);
      // Backups from before imported decks have no decks / notes.
      for (const rec of (backup[name] ?? []) as { id: string; updatedAt: number }[]) {
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
