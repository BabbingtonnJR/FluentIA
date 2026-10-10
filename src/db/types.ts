import type { Grade, State } from 'ts-fsrs';
import type { ItemKind } from '../content/types';

export type Direction = 'recognition' | 'production';

/** Every synced record carries updatedAt (ms, device clock) for last-write-wins merging. */
export interface Synced {
  id: string;
  updatedAt: number;
}

export interface CardRecord extends Synced {
  lang: string;
  kind: ItemKind;
  direction: Direction;
  itemId: string;
  level: number;
  // FSRS state (dates stored as epoch ms)
  due: number;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: State;
  lastReview: number | null;
  createdAt: number;
}

export interface ReviewRecord extends Synced {
  cardId: string;
  lang: string;
  rating: Grade;
  /** Card state before this review; State.New means this was the first time the card was studied. */
  prevState: State;
  reviewedAt: number;
  durationMs: number;
}

export type ActivityType = 'quiz' | 'handsfree' | 'reading' | 'mock';

export interface ActivityRecord extends Synced {
  lang: string;
  type: ActivityType;
  day: string; // study-day key, see time.ts
  score: number;
  total: number;
  minutes: number;
  createdAt: number;
  /** Mock tests: level and correct/total per section. */
  detail?: { level: number; sections: Record<string, [number, number]> };
}

export interface KvRecord extends Synced {
  value: unknown;
}

/** Local-only bookkeeping (sync cursors etc.), never synced. */
export interface MetaRecord {
  key: string;
  value: unknown;
}

export type Theme = 'auto' | 'light' | 'dark';

export interface Settings {
  lang: string;
  levels: number[];
  newPerDay: number;
  production: boolean;
  autoplay: boolean;
  voiceURI: string | null;
  speechRate: number;
  theme: Theme;
  /** Hour at which a new study day begins (like Anki), so late-night reviews count for the same day. */
  dayStartHour: number;
  /** Readings over kanji: always, only over kanji not studied yet, or never. */
  furigana: 'all' | 'unknown' | 'none';
  /** New grammar points per day, on top of newPerDay (grammar is slower to absorb than words). */
  grammarPerDay: number;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'ja',
  levels: [4, 3],
  newPerDay: 20,
  production: true,
  autoplay: true,
  voiceURI: null,
  speechRate: 0.9,
  theme: 'auto',
  dayStartHour: 4,
  furigana: 'unknown',
  grammarPerDay: 2,
};
