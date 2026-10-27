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

/**
 * A word that is just one kanji on its own (一, 上, 日). Its kanji card already teaches it, so it
 * gets no word card of its own: the same character twice would only be studied twice.
 */
export function oneKanjiWord(pack: Pack, v: VocabItem): string | null {
  const w = wordKey(v.word);
  return [...w].length === 1 && pack.kanjiById.has(w) ? w : null;
}

const KANA = /[ぁ-ゖー]/;
const toHiraganaReading = (r: string) => r.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/**
 * What sits next to the kanji in a word and decides its reading: the okurigana or kanji after it
 * (一つ → 〜つ, 一人 → 〜人, 上げる → 〜げる), or the kanji before it (同一 → 同〜). Null on its own.
 */
export function readingContext(word: string, kanji: string): string | null {
  const chars = [...word];
  const at = chars.indexOf(kanji);
  if (at < 0 || chars.length === 1) return null;
  if (at === 0) {
    if (KANA.test(chars[1])) {
      let end = 1;
      while (end < chars.length && KANA.test(chars[end])) end++;
      return `〜${chars.slice(1, end).join('')}`;
    }
    return `〜${chars[1]}`;
  }
  return `${chars[at - 1]}〜`;
}

/** A row of a kanji's readings: the reading, what around the kanji calls for it, and words using it. */
export interface KanjiReadingRow {
  reading: string;
  /** The usual reading: the kanji alone, or in most words. */
  main: boolean;
  /** Neighbours that call for this reading (〜つ, 〜人, 同〜); empty for the usual reading. */
  when: string[];
  words: VocabItem[];
}

/**
 * A kanji's readings as one list, in hiragana: the usual one first, then each other reading with
 * what around the kanji makes it read that way, so 一 reads いち, but ひと before つ or 人.
 */
export function kanjiReadingRows(pack: Pack, k: KanjiItem, wordsPerRow = 3): { rows: KanjiReadingRow[]; rare: string[] } {
  const { readings, rare } = kanjiReadings(pack, k);
  if (!readings.length) return { rows: [], rare: rare.map(toHiraganaReading) };
  const alone = readings.findIndex((r) => r.words.some((w) => wordKey(w.word) === k.id));
  const mainAt = alone >= 0 ? alone : readings.reduce((best, r, i) => (r.words.length > readings[best].words.length ? i : best), 0);
  const rows = readings.map((r, i): KanjiReadingRow => {
    const main = i === mainAt;
    const when = main ? [] : [...new Set(r.words.map((w) => readingContext(wordKey(w.word), k.id)).filter((c): c is string => !!c))].slice(0, 4);
    return { reading: toHiraganaReading(r.reading), main, when, words: r.words.slice(0, wordsPerRow) };
  });
  return { rows: [rows[mainAt], ...rows.filter((_, i) => i !== mainAt)], rare: rare.map(toHiraganaReading) };
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
