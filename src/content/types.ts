// A language pack is the unit of content: adding a language means adding a pack
// under public/packs/<id>/ and registering it in packs.ts.

export type ItemKind = 'vocab' | 'kanji' | 'grammar';

export interface PackManifest {
  id: string;
  name: string;
  nativeName: string;
  ttsLocale: string;
  levels: { id: number; label: string }[];
  kinds: ItemKind[];
  counts: Partial<Record<ItemKind, number>>;
  builtAt: string;
}

export interface VocabItem {
  id: string;
  word: string;
  reading: string;
  meaning: string;
  level: number;
}

export interface KanjiItem {
  id: string; // the character itself
  level: number;
  meanings: string[];
  on: string[];
  kun: string[];
  strokes: number;
  freq: number | null;
}

/** A reading sentence from Tatoeba (sentences.json), kept short in the file since there are thousands. */
export interface Sentence {
  i: number; // Tatoeba sentence ID, for attribution links
  r: string; // Japanese with furigana markup: [漢字|かん|じ]
  e: string; // English translation
  w: number[]; // indexes into Pack.vocab of the words it uses
  l: number; // JLPT level of its hardest word
}

/** A sentence showing a grammar point; `c` is the [start, end) of the grammar in the plain text. */
export interface GrammarExample {
  r: string; // Japanese with furigana markup
  e: string; // English translation
  c: [number, number];
  i?: number; // Tatoeba ID when borrowed from Tatoeba
}

export interface GrammarPoint {
  id: string; // e.g. "n4-tara"
  level: number;
  pattern: string; // e.g. 〜たら
  meaning: string;
  formation: string[];
  notes?: string;
  examples: GrammarExample[];
}

export interface Pack {
  manifest: PackManifest;
  vocab: VocabItem[];
  kanji: KanjiItem[];
  grammar: GrammarPoint[];
  vocabById: Map<string, VocabItem>;
  kanjiById: Map<string, KanjiItem>;
  grammarById: Map<string, GrammarPoint>;
}

/** What a flashcard shows, independent of which kind of item it came from. */
export interface CardFace {
  prompt: string;
  promptIsTarget: boolean; // true when the prompt is in the target language
  answer: string;
  reading?: string;
  details?: string[];
  speak: string; // text to read aloud in the target language
  meaning: string;
  /** Grammar cards: a sentence with the grammar blanked out, revealed on the back. */
  cloze?: { example: GrammarExample; pattern: string };
}

// --- Literature (public-domain stories, literature/*.json) ---------------------------

/**
 * One word of a story sentence, kept as a short array since stories have thousands:
 * [surface, dictionary form if different, part of speech, reading if it has kanji, vocab index, conjugation].
 * Trailing empty fields are left out.
 */
export type LitWord = [surface: string, base?: string, pos?: string, kana?: string, vocab?: number, form?: string];

export interface LitSentence {
  r: string; // furigana markup
  w: LitWord[];
  g?: [grammarId: string, start: number, end: number][];
}

/** A heading ({ h }) or a paragraph of sentences ({ s }). */
export type LitBlock = { h: string } | { s: LitSentence[] };

export interface LitMeta {
  id: string;
  title: string;
  titleEn: string;
  author: string;
  authorEn: string;
  /** Rough JLPT level, set by hand. */
  level: string;
  url: string;
  credit: { source?: string; input?: string; proof?: string };
  sentences: number;
  chars: number;
  /** Share of content words found in the N5–N3 word list. */
  coverage: number;
  byLevel: Record<number, number>;
  audio?: LitAudio;
}

/** Shelf entry: also the vocab indexes the story uses. */
export interface LitIndexEntry extends LitMeta {
  words: number[];
}

export interface LitWork extends LitMeta {
  body: LitBlock[];
}

// --- Comics (Pepper&Carrot, comics/*.json) -----------------------------------------------

export interface ComicBubble {
  /** Centre of the bubble as a share of the page's width and height. */
  x: number;
  y: number;
  s: LitSentence;
}

export interface ComicPage {
  img: string;
  b: ComicBubble[];
}

export interface ComicMeta {
  id: string;
  number: number;
  title: string;
  published?: string;
  credit: { art: string; translation: string[] };
  pages: number;
  bubbles: number;
}

export interface ComicIndexEntry extends ComicMeta {
  words: number[];
}

export interface ComicEpisode extends Omit<ComicMeta, 'pages'> {
  pages: ComicPage[];
}

/** A LibriVox reading of a story, one track per chapter (heading). */
export interface LitAudio {
  librivox: number;
  page: string;
  chapters: { url: string; seconds: number }[];
}
