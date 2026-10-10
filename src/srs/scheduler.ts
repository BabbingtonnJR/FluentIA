import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';
import type { ItemKind } from '../content/types';
import type { CardRecord, Direction, ReviewRecord } from '../db/types';
import { DAY, uid } from '../lib/time';

export { Rating, State, type Grade };

const scheduler = fsrs(generatorParameters({ request_retention: 0.9, enable_fuzz: true, maximum_interval: 3650 }));

export const GRADES: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];
export const GRADE_LABELS: Record<Grade, string> = {
  [Rating.Again]: 'Again',
  [Rating.Hard]: 'Hard',
  [Rating.Good]: 'Good',
  [Rating.Easy]: 'Easy',
};

export function cardId(lang: string, kind: ItemKind, direction: Direction, itemId: string): string {
  return `${lang}:${kind}:${direction}:${itemId}`;
}

export interface CardRef {
  lang: string;
  kind: ItemKind;
  direction: Direction;
  itemId: string;
  level: number;
}

function toFsrs(rec: CardRecord): Card {
  return {
    due: new Date(rec.due),
    stability: rec.stability,
    difficulty: rec.difficulty,
    elapsed_days: 0, // deprecated in ts-fsrs; derived from last_review
    scheduled_days: rec.scheduledDays,
    learning_steps: rec.learningSteps,
    reps: rec.reps,
    lapses: rec.lapses,
    state: rec.state,
    last_review: rec.lastReview == null ? undefined : new Date(rec.lastReview),
  };
}

function fromFsrs(card: Card): Pick<
  CardRecord,
  'due' | 'stability' | 'difficulty' | 'scheduledDays' | 'learningSteps' | 'reps' | 'lapses' | 'state' | 'lastReview'
> {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review ? card.last_review.getTime() : null,
  };
}

/** A card that has never been studied. Not stored until its first review. */
export function newCard(ref: CardRef, now: number): CardRecord {
  return {
    id: cardId(ref.lang, ref.kind, ref.direction, ref.itemId),
    ...ref,
    ...fromFsrs(createEmptyCard(new Date(now))),
    createdAt: now,
    updatedAt: now,
  };
}

/** Time until the card would next be due for each possible answer. */
export function previewIntervals(rec: CardRecord, now: number): Record<Grade, number> {
  const preview = scheduler.repeat(toFsrs(rec), new Date(now));
  const out = {} as Record<Grade, number>;
  for (const g of GRADES) out[g] = preview[g].card.due.getTime() - now;
  return out;
}

export function review(
  rec: CardRecord,
  grade: Grade,
  now: number,
  durationMs = 0,
): { card: CardRecord; log: ReviewRecord } {
  const { card } = scheduler.next(toFsrs(rec), new Date(now), grade);
  return {
    card: { ...rec, ...fromFsrs(card), updatedAt: now },
    log: {
      id: uid(),
      cardId: rec.id,
      lang: rec.lang,
      rating: grade,
      prevState: rec.state,
      reviewedAt: now,
      durationMs,
      updatedAt: now,
    },
  };
}

/**
 * Marks an item as already known without studying it: it becomes a review card due
 * at a random point in the next `minDays`–`maxDays`, so a whole level can be marked
 * known without creating a pile of reviews on a single day.
 */
export function knownCard(ref: CardRef, now: number, minDays = 20, maxDays = 90, rand = Math.random): CardRecord {
  const days = Math.round(minDays + rand() * (maxDays - minDays));
  return {
    ...newCard(ref, now),
    state: State.Review,
    stability: days,
    difficulty: 4,
    scheduledDays: days,
    reps: 1,
    due: now + days * DAY,
    lastReview: now,
  };
}

/** A card counts as "mature" once its stability passes three weeks, as in Anki. */
export function isMature(rec: CardRecord): boolean {
  return rec.state === State.Review && rec.stability >= 21;
}
