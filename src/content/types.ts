// A language pack is the unit of content: adding a language means adding a pack
// under public/packs/<id>/ and registering it in packs.ts.

export type ItemKind = 'vocab' | 'kanji';

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

export interface Pack {
  manifest: PackManifest;
  vocab: VocabItem[];
  kanji: KanjiItem[];
  vocabById: Map<string, VocabItem>;
  kanjiById: Map<string, KanjiItem>;
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
}
