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
