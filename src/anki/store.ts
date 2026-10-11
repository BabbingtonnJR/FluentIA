import { db, type FluentiaDB } from '../db/db';
import type { CardRecord } from '../db/types';
import { notifyLocalChange } from '../sync/events';
import { noteCardId, type ImportPlan } from './convert';

/**
 * Saves an import. Importing a deck again updates its notes but never loses progress: a card
 * is only replaced when the import has more reviews than the one already here.
 */
export async function applyImport(plan: ImportPlan, d: FluentiaDB = db): Promise<{ cards: number; notes: number }> {
  let cards = 0;
  await d.transaction('rw', d.decks, d.notes, d.cards, async () => {
    for (const deck of plan.decks) {
      const prev = await d.decks.get(deck.id);
      await d.decks.put(prev ? { ...prev, name: deck.name, deleted: false, updatedAt: deck.updatedAt } : deck);
    }
    await d.notes.bulkPut(plan.notes);
    const existing = await d.cards.bulkGet(plan.cards.map((c) => c.id));
    const toPut = plan.cards.filter((c, i) => {
      const prev = existing[i];
      return !prev || prev.deleted || prev.reps < c.reps;
    });
    await d.cards.bulkPut(toPut);
    cards = toPut.length;
  });
  notifyLocalChange();
  return { cards, notes: plan.notes.length };
}

/** Removes a deck with its notes and cards (as tombstones, so the removal reaches other devices). */
export async function deleteDeck(deckId: string, now = Date.now(), d: FluentiaDB = db): Promise<void> {
  await d.transaction('rw', d.decks, d.notes, d.cards, async () => {
    const deck = await d.decks.get(deckId);
    if (!deck) return;
    const notes = await d.notes.where('deckId').equals(deckId).toArray();
    await d.decks.put({ ...deck, deleted: true, updatedAt: now });
    await d.notes.bulkPut(notes.map((n) => ({ ...n, deleted: true, updatedAt: now })));
    const cards = (await d.cards.bulkGet(notes.map((n) => noteCardId(deck.lang, n.id)))).filter((c): c is CardRecord => !!c);
    await d.cards.bulkPut(cards.map((c) => ({ ...c, deleted: true, updatedAt: now })));
  });
  notifyLocalChange();
}

export async function setDeckNewPerDay(deckId: string, newPerDay: number, d: FluentiaDB = db): Promise<void> {
  await d.decks.update(deckId, { newPerDay, updatedAt: Date.now() });
  notifyLocalChange();
}
