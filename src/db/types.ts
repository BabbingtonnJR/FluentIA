import type { VideoLine } from '../video/analyse';
import type { Grade, State } from 'ts-fsrs';
import type { ItemKind, LitSentence } from '../content/types';

export type Direction = 'recognition' | 'production';

/** Every synced record carries updatedAt (ms, device clock) for last-write-wins merging. */
export interface Synced {
  id: string;
  updatedAt: number;
}

/** Built-in study items, or a card from a deck the learner imported (its itemId is a NoteRecord id). */
export type CardKind = ItemKind | 'custom';

export interface CardRecord extends Synced {
  lang: string;
  kind: CardKind;
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
  /** Removed with its deck; kept as a tombstone so the removal syncs to other devices. */
  deleted?: boolean;
}

/** A deck of the learner's own cards, imported from Anki. Synced. */
export interface DeckRecord extends Synced {
  lang: string;
  name: string;
  /** New cards from this deck per day, on top of the built-in ones. */
  newPerDay: number;
  createdAt: number;
  deleted?: boolean;
}

/** One card's content in an imported deck. Synced. */
export interface NoteRecord extends Synced {
  lang: string;
  deckId: string;
  /** Front, as plain text (shown as the question). */
  front: string;
  /** Furigana markup for the front ([漢字|かんじ]), when the deck has readings. */
  reading?: string;
  /** Back: the answer, plain text with line breaks. */
  back: string;
  /** Position in the deck: new cards are introduced in this order. */
  order: number;
  createdAt: number;
  deleted?: boolean;
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

export type ActivityType = 'quiz' | 'handsfree' | 'reading' | 'mock' | 'wordle' | 'crossword' | 'literature';

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

/** A video the learner imported with its subtitles, kept on this device only. */
export interface VideoRecord {
  id: string;
  lang: string;
  title: string;
  createdAt: number;
  subtitleName: string;
  /** Subtitle lines with their breakdowns. */
  lines: VideoLine[];
  /** The video itself, if the learner chose to keep it in the app. */
  video?: Blob;
  videoName?: string;
}

/** A speech bubble in an imported manga: where it is (as a share of the page) and its breakdown. */
export interface MangaBlock {
  /** [left, top, right, bottom], each between 0 and 1. */
  box: [number, number, number, number];
  s: LitSentence;
}

/** A manga volume imported from mokuro's output, kept on this device only. */
export interface MangaRecord {
  id: string;
  lang: string;
  title: string;
  createdAt: number;
  /** The file it was imported from. */
  source: string;
  pages: { b: MangaBlock[] }[];
}

/** One page image of an imported manga. */
export interface MangaImage {
  id: string; // `${mangaId}:${page}`
  mangaId: string;
  page: number;
  blob: Blob;
}
