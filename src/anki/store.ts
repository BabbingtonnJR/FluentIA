import { db, type FluentiaDB } from '../db/db';
import type { CardRecord, MediaRecord } from '../db/types';
import { notifyLocalChange } from '../sync/events';
import type { MediaFiles } from './apkg';
import { noteCardId, type ImportPlan } from './convert';

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  webm: 'audio/webm',
  flac: 'audio/flac',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
const mimeOf = (name: string) => MIME[name.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';

/**
 * Saves an import. Importing a deck again updates its notes but never loses progress: a card
 * is only replaced when the import has more reviews than the one already here. Pictures and
 * sounds the notes use are kept on this device (they are not synced).
 */
export async function applyImport(plan: ImportPlan, files: MediaFiles = new Map(), d: FluentiaDB = db): Promise<{ cards: number; notes: number; media: number }> {
  // Read the media first: an IndexedDB transaction cannot wait for other work.
  const media: MediaRecord[] = [];
  for (const name of plan.media) {
    const read = files.get(name);
    if (read) media.push({ id: name, blob: new Blob([await read()], { type: mimeOf(name) }) });
  }
  let cards = 0;
  await d.transaction('rw', [d.decks, d.notes, d.cards, d.media], async () => {
    for (const deck of plan.decks) {
      const prev = await d.decks.get(deck.id);
      await d.decks.put(prev ? { ...prev, name: deck.name, deleted: false, updatedAt: deck.updatedAt } : deck);
    }
    await d.notes.bulkPut(plan.notes);
    await d.media.bulkPut(media);
    const existing = await d.cards.bulkGet(plan.cards.map((c) => c.id));
    const toPut = plan.cards.filter((c, i) => {
      const prev = existing[i];
      return !prev || prev.deleted || prev.reps < c.reps;
    });
    await d.cards.bulkPut(toPut);
    cards = toPut.length;
  });
  notifyLocalChange();
  return { cards, notes: plan.notes.length, media: media.length };
}

/**
 * Removes a deck with its notes and cards (as tombstones, so the removal reaches other devices)
 * and the pictures and sounds no other deck uses.
 */
export async function deleteDeck(deckId: string, now = Date.now(), d: FluentiaDB = db): Promise<void> {
  await d.transaction('rw', [d.decks, d.notes, d.cards, d.media], async () => {
    const deck = await d.decks.get(deckId);
    if (!deck) return;
    const notes = await d.notes.where('deckId').equals(deckId).toArray();
    await d.decks.put({ ...deck, deleted: true, updatedAt: now });
    await d.notes.bulkPut(notes.map((n) => ({ ...n, deleted: true, updatedAt: now })));
    const ids = notes.flatMap((n) => [noteCardId(deck.lang, n.id), noteCardId(deck.lang, n.id, 'production')]);
    const cards = (await d.cards.bulkGet(ids)).filter((c): c is CardRecord => !!c);
    await d.cards.bulkPut(cards.map((c) => ({ ...c, deleted: true, updatedAt: now })));

    const stillUsed = new Set(
      (await d.notes.toArray()).filter((n) => !n.deleted).flatMap((n) => [...(n.media?.front ?? []), ...(n.media?.back ?? [])]),
    );
    const unused = notes.flatMap((n) => [...(n.media?.front ?? []), ...(n.media?.back ?? [])]).filter((m) => !stillUsed.has(m));
    await d.media.bulkDelete(unused);
  });
  notifyLocalChange();
}

export async function setDeckNewPerDay(deckId: string, newPerDay: number, d: FluentiaDB = db): Promise<void> {
  await d.decks.update(deckId, { newPerDay, updatedAt: Date.now() });
  notifyLocalChange();
}
