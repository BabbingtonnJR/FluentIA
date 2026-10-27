// The plan to the next JLPT: how much of the level is still unseen, how many new items a day
// that takes until the exam, and whether the current pace gets there.
import { primaryVocabId, studyVocab } from '../content/senses';
import type { Pack } from '../content/types';
import type { CardRecord, ReviewRecord } from '../db/types';
import { DAY } from '../lib/time';
import { State } from '../srs/scheduler';

/**
 * The JLPT is held on the first Sunday of July and of December (in Brazil, December only, but
 * the date is the same). The next one on or after `from`, as YYYY-MM-DD.
 */
export function nextJlptDate(from: Date): string {
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12);
  for (let y = from.getFullYear(); ; y++) {
    for (const month of [6, 11]) {
      const d = new Date(y, month, 1, 12);
      d.setDate(1 + ((7 - d.getDay()) % 7));
      if (d >= today) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
}

/** Last days before the exam kept free of new items, for reviews and mock tests. */
export const REVIEW_DAYS = 7;

export interface KindProgress {
  total: number;
  /** Studied at least once (or marked known). */
  seen: number;
}

export interface ExamPlan {
  level: number;
  date: string;
  daysLeft: number;
  words: KindProgress;
  kanji: KindProgress;
  grammar: KindProgress;
  /** New words + kanji a day to see everything before the review week. */
  wordsPerDay: number;
  grammarPerDay: number;
  /** New items a day over the last two weeks. */
  pace: number;
  /** When everything would be seen at the current pace, or null if nothing new is being studied. */
  finishAt: number | null;
}

/** Everything the exam level covers: that level and the easier ones below it. */
export function examPlan(pack: Pack, cards: CardRecord[], reviews: ReviewRecord[], level: number, date: string, now = Date.now()): ExamPlan {
  const lang = pack.manifest.id;
  const seenIds = new Set(
    cards
      .filter((c) => !c.deleted && c.direction === 'recognition' && c.state !== State.New)
      .map((c) => (c.kind === 'vocab' ? `${lang}:vocab:${primaryVocabId(pack, c.itemId)}` : `${lang}:${c.kind}:${c.itemId}`)),
  );
  const count = (ids: string[]): KindProgress => ({ total: ids.length, seen: ids.filter((id) => seenIds.has(id)).length });
  const inScope = (l: number) => l >= level;
  const words = count(studyVocab(pack).filter((v) => inScope(v.level)).map((v) => `${lang}:vocab:${v.id}`));
  const kanji = count(pack.kanji.filter((k) => inScope(k.level)).map((k) => `${lang}:kanji:${k.id}`));
  const grammar = count(pack.grammar.filter((g) => inScope(g.level)).map((g) => `${lang}:grammar:${g.id}`));

  const [y, m, d] = date.split('-').map(Number);
  const examAt = new Date(y, m - 1, d, 9).getTime();
  const daysLeft = Math.max(0, Math.ceil((examAt - now) / DAY));
  const studyDays = Math.max(1, daysLeft - REVIEW_DAYS);
  const left = (k: KindProgress) => k.total - k.seen;

  const since = now - 14 * DAY;
  const fresh = reviews.filter((r) => r.reviewedAt >= since && r.prevState === State.New).length;
  const pace = fresh / 14;
  const remaining = left(words) + left(kanji) + left(grammar);

  return {
    level,
    date,
    daysLeft,
    words,
    kanji,
    grammar,
    wordsPerDay: Math.ceil((left(words) + left(kanji)) / studyDays),
    grammarPerDay: Math.ceil(left(grammar) / studyDays),
    pace,
    finishAt: remaining === 0 ? now : pace > 0 ? now + (remaining / pace) * DAY : null,
  };
}
