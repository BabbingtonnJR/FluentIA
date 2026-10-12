// Words written the same way (十 じゅう / とお, 〜中 ちゅう / じゅう, 中 なか) are one study card
// that shows every reading, when each is used, and example sentences for each. The word list
// keeps them as separate entries (sentences and stories link to them by index), so the grouping
// is worked out here, once per pack.
import { normReading, wordKey } from '../../shared/japanese/senses.mjs';
import type { KanjiItem, Pack, VocabItem, WordExample } from './types';

export { normReading, wordKey };

interface Groups {
  /** One entry per written form, in teaching order: what new cards are made from. */
  study: VocabItem[];
  /** Every entry of a written form, by the id of the form's first entry. */
  members: Map<string, VocabItem[]>;
  /** Any entry's id → the id of its form's first entry. */
  primary: Map<string, string>;
  index: Map<string, number>;
}

const cache = new WeakMap<Pack, Groups>();

function groups(pack: Pack): Groups {
  let g = cache.get(pack);
  if (g) return g;
  const byKey = new Map<string, VocabItem[]>();
  for (const v of pack.vocab) {
    const k = wordKey(v.word);
    const list = byKey.get(k);
    if (list) list.push(v);
    else byKey.set(k, [v]);
  }
  const study: VocabItem[] = [];
  const members = new Map<string, VocabItem[]>();
  const primary = new Map<string, string>();
  for (const v of pack.vocab) {
    const list = byKey.get(wordKey(v.word))!;
    if (list[0] !== v) continue;
    study.push(v);
    members.set(v.id, list);
    for (const m of list) primary.set(m.id, v.id);
  }
  g = { study, members, primary, index: new Map(pack.vocab.map((v, i) => [v.id, i])) };
  cache.set(pack, g);
  return g;
}

/** The words to study: one per written form. */
export const studyVocab = (pack: Pack): VocabItem[] => groups(pack).study;

/** The id of the card that teaches this word (the first entry written the same way). */
export const primaryVocabId = (pack: Pack, id: string): string => groups(pack).primary.get(id) ?? id;

/** Every entry written like this word, the card's own entry first. */
export function vocabGroup(pack: Pack, id: string): VocabItem[] {
  const g = groups(pack);
  const own = pack.vocabById.get(id);
  return g.members.get(g.primary.get(id) ?? id) ?? (own ? [own] : []);
}

/** Whether two entries are written the same way, so one can't be a wrong option for the other. */
export const sameWord = (a: VocabItem, b: VocabItem): boolean => wordKey(a.word) === wordKey(b.word);

export const vocabIndex = (pack: Pack, id: string): number | undefined => groups(pack).index.get(id);

/** One reading of a word card. */
export interface VocabSense {
  item: VocabItem;
  /** The reading as hiragana, without the word list's decorations ("(〜を) とお" → "とお"). */
  reading: string;
  meaning: string;
  /** When this reading is used (only for words with several readings). */
  note?: string;
  examples: WordExample[];
}

function senseOf(pack: Pack, v: VocabItem): VocabSense {
  const i = vocabIndex(pack, v.id);
  const data = i === undefined ? undefined : pack.examples?.words[i];
  return {
    item: v,
    reading: normReading(v.reading) || v.reading,
    meaning: data?.m ?? v.meaning,
    note: data?.n,
    examples: (data?.x ?? []).map(([r, e, id]) => ({ r, e, ...(id ? { i: id } : {}) })),
  };
}

/** The readings a word card teaches, the card's own entry first, each with its examples. */
export function vocabSenses(pack: Pack, id: string): VocabSense[] {
  return vocabGroup(pack, id).map((v) => senseOf(pack, v));
}

/** A kanji reading and the words that use it. */
export interface KanjiReading {
  reading: string;
  on: boolean;
  words: VocabItem[];
}

/** A kanji's readings with words that use each, and the readings no listed word uses. */
export function kanjiReadings(pack: Pack, k: KanjiItem): { readings: KanjiReading[]; rare: string[] } {
  const data = pack.examples?.kanji[k.id];
  if (!data) return { readings: [], rare: [] };
  return {
    readings: data.r.map(([reading, ws]) => ({
      reading,
      on: /^[ァ-ヶー]+$/.test(reading),
      words: ws.flatMap((i) => pack.vocab[i] ?? []),
    })),
    rare: data.rare ?? [],
  };
}
