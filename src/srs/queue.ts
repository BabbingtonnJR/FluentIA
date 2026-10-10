import type { Pack } from '../content/types';
import type { CardRecord, Settings } from '../db/types';
import { cardId, State, type CardRef } from './scheduler';

export type QueueEntry = { type: 'review'; cardId: string } | { type: 'new'; ref: CardRef };

export interface NewSelectionInput {
  pack: Pack;
  settings: Pick<Settings, 'levels' | 'newPerDay' | 'production'>;
  /** Ids of every card that already exists (any state). */
  existing: Set<string>;
  /** Item ids whose vocab recognition card has graduated to Review. */
  graduatedVocab: Set<string>;
  introducedToday: { recognition: number; production: number };
  /** One kanji is introduced for every this many words. */
  vocabPerKanji?: number;
}

/** Daily cap for production (English → Japanese) cards. */
export function productionLimit(newPerDay: number): number {
  return Math.ceil(newPerDay / 2);
}

/**
 * Chooses today's new cards. Recognition cards come from the enabled levels, easiest
 * level first, mixing in kanji between words. Production cards are only unlocked for
 * words you already recognise reliably.
 */
export function selectNew(input: NewSelectionInput): CardRef[] {
  const { pack, settings, existing, graduatedVocab, introducedToday } = input;
  const lang = pack.manifest.id;
  const vocabPerKanji = input.vocabPerKanji ?? 4;
  const out: CardRef[] = [];

  let recognitionLeft = Math.max(0, settings.newPerDay - introducedToday.recognition);
  const levels = [...settings.levels].sort((a, b) => b - a);
  for (const level of levels) {
    if (recognitionLeft === 0) break;
    const words = pack.vocab.filter(
      (v) => v.level === level && !existing.has(cardId(lang, 'vocab', 'recognition', v.id)),
    );
    const kanji = pack.kanji.filter(
      (k) => k.level === level && !existing.has(cardId(lang, 'kanji', 'recognition', k.id)),
    );
    let w = 0;
    let k = 0;
    while (recognitionLeft > 0 && (w < words.length || k < kanji.length)) {
      const kanjiTurn = k < kanji.length && (w >= words.length || (w + k) % (vocabPerKanji + 1) === 0);
      if (kanjiTurn) {
        out.push({ lang, kind: 'kanji', direction: 'recognition', itemId: kanji[k].id, level });
        k++;
      } else {
        out.push({ lang, kind: 'vocab', direction: 'recognition', itemId: words[w].id, level });
        w++;
      }
      recognitionLeft--;
    }
  }

  if (settings.production) {
    let productionLeft = Math.max(0, productionLimit(settings.newPerDay) - introducedToday.production);
    for (const v of pack.vocab) {
      if (productionLeft === 0) break;
      if (!graduatedVocab.has(v.id)) continue;
      if (existing.has(cardId(lang, 'vocab', 'production', v.id))) continue;
      out.push({ lang, kind: 'vocab', direction: 'production', itemId: v.id, level: v.level });
      productionLeft--;
    }
  }

  return out;
}

/** Spreads new cards evenly between due reviews so a session never starts with a wall of new words. */
export function buildQueue(due: CardRecord[], fresh: CardRef[]): QueueEntry[] {
  const reviews: QueueEntry[] = [...due]
    .sort((a, b) => a.due - b.due)
    .map((c) => ({ type: 'review', cardId: c.id }));
  const news: QueueEntry[] = fresh.map((ref) => ({ type: 'new', ref }));
  if (!reviews.length || !news.length) return [...reviews, ...news];

  const spacing = Math.max(1, Math.floor(reviews.length / news.length));
  const out: QueueEntry[] = [];
  let n = 0;
  reviews.forEach((r, i) => {
    out.push(r);
    if ((i + 1) % spacing === 0 && n < news.length) out.push(news[n++]);
  });
  while (n < news.length) out.push(news[n++]);
  return out;
}

/** Cards answered with a short relearning step come back later in the same session. */
export const REQUEUE_WITHIN_MS = 30 * 60_000;

export function requeuePosition(queueLength: number, cursor: number): number {
  // Show it again after a few other cards, or at the end if the queue is short.
  return Math.min(queueLength, cursor + 1 + 4);
}

export function isLearning(rec: CardRecord): boolean {
  return rec.state === State.Learning || rec.state === State.Relearning;
}
