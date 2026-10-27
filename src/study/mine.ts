// Sentence mining: a word met while reading or watching becomes a card, and the sentence it was
// met in comes along so the card shows it in context.
import { primaryVocabId } from '../content/senses';
import type { Pack } from '../content/types';
import { db, type FluentiaDB } from '../db/db';
import type { DeckRecord, NoteRecord } from '../db/types';
import { uid } from '../lib/time';
import { plainText } from '../reading/furigana';
import { cardId, newCard } from '../srs/scheduler';
import { notifyLocalChange } from '../sync/events';
import { saveContext, type MinedContext } from './weak';

export interface MinedSentence {
  /** Furigana markup. */
  r: string;
  e?: string;
  /** Title of the story, comic, manga or video. */
  source?: string;
}

/** The card a word from the word list is studied with (one per written form, see senses.ts). */
export function vocabCardId(pack: Pack, vocabId: string): string {
  return cardId(pack.manifest.id, 'vocab', 'recognition', primaryVocabId(pack, vocabId));
}

/**
 * Starts studying a word from the word list (due right away), keeping the sentence it was met in.
 * A word already studied only gets the sentence. Returns whether a new card was made.
 */
export async function mineVocab(pack: Pack, vocabId: string, sentence: MinedSentence, now = Date.now(), d: FluentiaDB = db): Promise<boolean> {
  const lang = pack.manifest.id;
  const id = primaryVocabId(pack, vocabId);
  const v = pack.vocabById.get(id);
  if (!v) return false;
  const ctx: MinedContext = { r: sentence.r, ...(sentence.e ? { e: sentence.e } : {}), ...(sentence.source ? { source: sentence.source } : {}), at: now };
  await saveContext(lang, { kind: 'vocab', id }, ctx, d);
  const existing = await d.cards.get(cardId(lang, 'vocab', 'recognition', id));
  if (existing && !existing.deleted) return false;
  await d.cards.put(newCard({ lang, kind: 'vocab', direction: 'recognition', itemId: id, level: v.level }, now));
  notifyLocalChange();
  return true;
}

export const minedDeckId = (lang: string) => `mined-${lang}`;

/**
 * A word outside the word list becomes a card in the learner's own "Mined words" deck: the word
 * with its reading on the front, the meaning they wrote and the sentence on the back.
 */
export async function mineCustom(
  lang: string,
  word: { text: string; reading?: string; meaning: string },
  sentence: MinedSentence,
  now = Date.now(),
  d: FluentiaDB = db,
): Promise<NoteRecord> {
  const deckId = minedDeckId(lang);
  const plain = plainText(sentence.r);
  const lines = [word.meaning.trim(), '', plain];
  if (sentence.e) lines.push(sentence.e);
  if (sentence.source) lines.push(`— ${sentence.source}`);
  const back = lines.join('\n').trim();
  let note!: NoteRecord;
  await d.transaction('rw', [d.decks, d.notes, d.cards], async () => {
    const deck = await d.decks.get(deckId);
    if (!deck) {
      const rec: DeckRecord = { id: deckId, lang, name: 'Mined words', newPerDay: 10, createdAt: now, updatedAt: now };
      await d.decks.put(rec);
    } else if (deck.deleted) {
      await d.decks.put({ ...deck, deleted: false, updatedAt: now });
    }
    const order = await d.notes.where('deckId').equals(deckId).count();
    note = {
      id: uid(),
      lang,
      deckId,
      front: word.text,
      ...(word.reading && word.reading !== word.text ? { reading: `[${word.text}|${word.reading}]` } : {}),
      back,
      order,
      createdAt: now,
      updatedAt: now,
    };
    await d.notes.put(note);
    await d.cards.put(newCard({ lang, kind: 'custom', direction: 'recognition', itemId: note.id, level: 0 }, now));
  });
  notifyLocalChange();
  return note;
}
