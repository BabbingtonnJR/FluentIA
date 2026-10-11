import type { CardFace, Pack } from '../content/types';
import type { CardRecord, DeckRecord, NoteRecord } from '../db/types';
import { toHiragana } from '../lang/romaji';
import { DAY } from '../lib/time';
import { cardId, newCard, State, type CardRef } from '../srs/scheduler';
import type { AnkiCard, AnkiCollection, AnkiNoteType } from './apkg';

// --- Field text -----------------------------------------------------------------------

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** A field's HTML as plain text: no tags, sounds, images or cloze markers; <br> and blocks become line breaks. */
export function cleanField(html: string): string {
  return html
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(div|p|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|\w+);/g, (m, e: string) => ENTITIES[e] ?? (e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1))) : m))
    .replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, '$1')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

const HAN = /[\p{Script=Han}々〆ヶ]/u;
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const ANKI_RUBY = /([\p{Script=Han}々〆ヶ]+)\[([^\]]+)\]/gu;

/**
 * Anki's furigana notation (日本[にほん]語[ご], with a space before each reading group) as plain
 * text plus the app's ruby markup ([日本|にほん]語). `markup` is absent when there is no reading.
 */
export function ankiFurigana(text: string): { plain: string; markup?: string } {
  if (!/\[[^\]]+\]/.test(text)) return { plain: text };
  const joined = text.trim().replace(/ (?=[^ [\]]*\[)/g, '');
  const plain = joined.replace(/\[[^\]]*\]/g, '');
  const markup = joined.replace(ANKI_RUBY, (_, base: string, reading: string) => `{${base}|${reading}}`).replace(/\[[^\]]*\]/g, '');
  return { plain, markup: markup.replace(/\{([^|}]+)\|([^}]+)\}/g, '[$1|$2]') };
}

/** The kana reading of ruby markup: [日本|にほん]語 → にほん語. */
export const markupReading = (markup: string) => markup.replace(/\[[^|\]]+\|([^\]]+)\]/g, (_, r: string) => r.replace(/\|/g, ''));

// --- Which field is what ------------------------------------------------------------------

/** Which fields of a note type hold the question, its reading and the answer. */
export interface Roles {
  front: number;
  reading: number | null;
  back: number[];
}

const FRONT = /^(front|expression|word|vocab(ulary)?|kanji|japanese|term|question|sentence|text|単語|語彙|表現|漢字)$/i;
const READING = /reading|kana|furigana|yomi|pronunciation|読み|ふりがな/i;
const BACK = /meaning|english|definition|back|gloss|translation|answer|意味|英語|訳/i;
const IGNORE = /audio|sound|image|picture|\bpic\b|reverse|freq|^id$|sort|tags?$|notes?$|source|pitch/i;

/** A best guess from field names and a few notes; the import screen lets the learner change it. */
export function guessRoles(type: AnkiNoteType, samples: string[][]): Roles {
  const names = type.fields;
  const filled = (i: number) => samples.some((s) => cleanField(s[i] ?? ''));
  let front = names.findIndex((n) => FRONT.test(n.trim()));
  if (front < 0) front = 0;
  const r = names.findIndex((n, i) => i !== front && READING.test(n));
  const reading = r < 0 ? null : r;
  const others = names.map((_, i) => i).filter((i) => i !== front && i !== reading && !IGNORE.test(names[i]));
  const named = others.filter((i) => BACK.test(names[i]));
  return { front, reading, back: named.length ? named : others.filter(filled) };
}

// --- Matching notes to the app's own items -------------------------------------------------

type ItemRef = Pick<CardRef, 'kind' | 'itemId' | 'level'>;

// The wave dash marks affixes (～日 "day of the month"), so it stays: 日 alone is the kanji.
const key = (s: string) => toHiragana(s.normalize('NFKC').replace(/\s/g, '').replace(/[〜~]/g, '～'));

/** Finds the app's word (or single kanji) for a note's word and reading. */
export function itemMatcher(pack: Pack): (word: string, reading?: string) => ItemRef | null {
  const byWord = new Map<string, { id: string; level: number; readings: string[] }[]>();
  for (const v of pack.vocab) {
    const entry = { id: v.id, level: v.level, readings: v.reading.split(/;\s*/).map(key) };
    for (const w of v.word.split(/;\s*/)) {
      const k = key(w);
      byWord.set(k, [...(byWord.get(k) ?? []), entry]);
    }
  }
  return (word, reading) => {
    // Decks write variants like the app's list does: 足; 脚 / いい; よい.
    const words = word.split(/[;；、]\s*/).map(key).filter(Boolean);
    if (!words.length) return null;
    const candidates = words.flatMap((w) => byWord.get(w) ?? []);
    const readings = reading ? reading.split(/[;；、]\s*/).map(key) : [];
    // With a reading, it must agree (今日 きょう vs こんにち); without one, kanji words are ambiguous.
    const hit = readings.length
      ? candidates.find((c) => c.readings.some((r) => readings.includes(r)))
      : HAN.test(word) && new Set(candidates.map((c) => c.id)).size > 1
        ? undefined
        : candidates[0];
    if (hit) return { kind: 'vocab', itemId: hit.id, level: hit.level };
    const k = pack.kanjiById.get(word.trim());
    if (k && [...word.trim()].length === 1) return { kind: 'kanji', itemId: k.id, level: k.level };
    return null;
  };
}

// --- Scheduling ------------------------------------------------------------------------------

/** Anki ease (1300–3000‰ and up) as an FSRS difficulty (10 hardest – 1 easiest). */
const difficultyFromEase = (factor: number) => Math.min(10, Math.max(1, 11 - ((factor || 2500) - 1300) / 190));

type Schedule = Pick<CardRecord, 'due' | 'stability' | 'difficulty' | 'scheduledDays' | 'learningSteps' | 'reps' | 'lapses' | 'state' | 'lastReview'>;

/**
 * A studied Anki card's progress as FSRS state. A review card keeps its due date and interval
 * (the interval stands in for stability); learning cards are due now. New cards return null.
 */
export function scheduleFromAnki(card: AnkiCard, crt: number, now: number): Schedule | null {
  if (card.type === 0) return null;
  const difficulty = difficultyFromEase(card.factor);
  if (card.type === 2) {
    const ivl = Math.max(1, card.ivl);
    const due = (crt + card.due * 86400) * 1000;
    return {
      due,
      stability: ivl,
      difficulty,
      scheduledDays: ivl,
      learningSteps: 0,
      reps: card.reps,
      lapses: card.lapses,
      state: State.Review,
      lastReview: Math.min(now, due - ivl * DAY),
    };
  }
  return {
    due: now,
    stability: 1,
    difficulty,
    scheduledDays: 0,
    learningSteps: 0,
    reps: card.reps,
    lapses: card.lapses,
    state: card.type === 3 ? State.Relearning : State.Learning,
    lastReview: now,
  };
}

// --- The import plan ------------------------------------------------------------------------

export interface ImportOptions {
  lang: string;
  /** Anki deck ids to import (subdecks are listed on their own). */
  deckIds: Set<string>;
  /** Field roles per note type id. */
  roles: Map<string, Roles>;
  /** Use the app's own card for words and kanji it already has. */
  useBuiltIn: boolean;
  /** Bring the review progress along (otherwise everything starts as new). */
  withProgress: boolean;
  now: number;
}

export interface ImportPlan {
  decks: DeckRecord[];
  notes: NoteRecord[];
  cards: CardRecord[];
  /** Notes that became the app's own words or kanji. */
  matched: number;
  /** …of which already studied in Anki (their progress comes along). */
  matchedStudied: number;
  custom: number;
  suspended: number;
  empty: number;
}

export const DEFAULT_DECK_NEW_PER_DAY = 10;

/** Ruby for a whole word from a separate reading field: 自転車 + じてんしゃ → [自転車|じてんしゃ]. */
function wordRuby(word: string, kana: string): string | undefined {
  if (!HAN.test(word) || JAPANESE.test(kana) === false || /\s|[、。,.]/.test(word) || [...word].length > 8) return undefined;
  return `[${word}|${kana}]`;
}

/** Decides what each note becomes. Pure: nothing is written until applyImport. */
export function planImport(col: AnkiCollection, pack: Pack, opts: ImportOptions): ImportPlan {
  const { lang, now } = opts;
  const match = itemMatcher(pack);
  // Each note's main card: the first template (usually front → back).
  const mainCard = new Map<string, AnkiCard>();
  for (const c of col.cards) {
    const prev = mainCard.get(c.noteId);
    if (!prev || c.ord < prev.ord) mainCard.set(c.noteId, c);
  }

  const plan: ImportPlan = { decks: [], notes: [], cards: [], matched: 0, matchedStudied: 0, custom: 0, suspended: 0, empty: 0 };
  const builtIn = new Map<string, CardRecord>();
  const usedDecks = new Set<string>();
  let order = 0;

  for (const note of col.notes) {
    const card = mainCard.get(note.id);
    const roles = opts.roles.get(note.typeId);
    if (!card || !roles || !opts.deckIds.has(card.deckId)) continue;
    if (card.queue === -1) {
      plan.suspended++;
      continue;
    }
    const front = ankiFurigana(cleanField(note.fields[roles.front] ?? ''));
    const readingField = roles.reading == null ? null : ankiFurigana(cleanField(note.fields[roles.reading] ?? ''));
    const back = roles.back.map((i) => ankiFurigana(cleanField(note.fields[i] ?? '')).plain).filter(Boolean).join('\n');
    if (!front.plain || !back) {
      plan.empty++;
      continue;
    }
    // Ruby for the front: from the front itself (日本[にほん]), a reading field with the same
    // text and furigana, or a plain kana reading of a single word.
    let ruby = front.markup;
    let readingKana: string | undefined;
    if (readingField?.plain) {
      if (readingField.markup && readingField.plain === front.plain) ruby = readingField.markup;
      else if (!JAPANESE.test(readingField.plain) || HAN.test(readingField.plain)) readingKana = undefined;
      else readingKana = readingField.plain;
      ruby ??= readingKana ? wordRuby(front.plain, readingKana) : undefined;
    }
    readingKana ??= ruby ? markupReading(ruby) : undefined;

    const schedule = opts.withProgress ? scheduleFromAnki(card, col.crt, now) : null;
    const item = opts.useBuiltIn ? match(front.plain, readingKana) : null;
    if (item) {
      plan.matched++;
      if (!schedule) continue; // not studied yet: the app introduces it in its own order
      plan.matchedStudied++;
      const rec: CardRecord = { ...newCard({ lang, direction: 'recognition', ...item }, now), ...schedule };
      const prev = builtIn.get(rec.id);
      if (!prev || prev.reps < rec.reps) builtIn.set(rec.id, rec);
      continue;
    }

    plan.custom++;
    usedDecks.add(card.deckId);
    const noteId = `anki:${note.guid}`;
    // A reading that could not become ruby is shown on the back instead.
    const shownReading = readingKana && !ruby && readingKana !== front.plain ? readingKana : undefined;
    plan.notes.push({
      id: noteId,
      lang,
      deckId: `anki:${card.deckId}`,
      front: front.plain,
      ...(ruby ? { reading: ruby } : {}),
      back: shownReading ? `${shownReading}\n${back}` : back,
      order: order++,
      createdAt: now,
      updatedAt: now,
    });
    if (schedule) plan.cards.push({ ...newCard({ lang, kind: 'custom', direction: 'recognition', itemId: noteId, level: 0 }, now), ...schedule });
  }

  plan.cards.push(...builtIn.values());
  for (const ankiId of usedDecks) {
    plan.decks.push({
      id: `anki:${ankiId}`,
      lang,
      name: col.decks.get(ankiId) ?? 'Anki deck',
      newPerDay: DEFAULT_DECK_NEW_PER_DAY,
      createdAt: now,
      updatedAt: now,
    });
  }
  return plan;
}

// --- Studying a custom card ------------------------------------------------------------------

/** The flashcard for a note from an imported deck. */
export function customFace(note: NoteRecord): CardFace {
  const reading = note.reading ? markupReading(note.reading) : undefined;
  const promptIsTarget = JAPANESE.test(note.front);
  const japanese = promptIsTarget ? (reading ?? note.front) : (note.back.split('\n').find((l) => JAPANESE.test(l)) ?? '');
  return {
    prompt: note.front,
    promptIsTarget,
    answer: note.back,
    reading: reading && reading !== note.front ? reading : undefined,
    speak: japanese,
    meaning: note.back,
  };
}

/** Card id of a note's card. */
export const noteCardId = (lang: string, noteId: string) => cardId(lang, 'custom', 'recognition', noteId);
