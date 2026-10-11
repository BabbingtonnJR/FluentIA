import type { CardFace, Pack } from '../content/types';
import type { CardRecord, DeckRecord, Direction, NoteRecord } from '../db/types';
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
  /** Picture and sound files the imported notes use. */
  media: string[];
  /** Notes that became the app's own words or kanji. */
  matched: number;
  /** …of which already studied in Anki (their progress comes along). */
  matchedStudied: number;
  custom: number;
  /** Notes asked both ways (Anki's reversed cards). */
  reverse: number;
  suspended: number;
  empty: number;
}

export const DEFAULT_DECK_NEW_PER_DAY = 10;

/** Ruby for a whole word from a separate reading field: 自転車 + じてんしゃ → [自転車|じてんしゃ]. */
function wordRuby(word: string, kana: string): string | undefined {
  if (!HAN.test(word) || JAPANESE.test(kana) === false || /\s|[、。,.]/.test(word) || [...word].length > 8) return undefined;
  return `[${word}|${kana}]`;
}

/** Pictures and sounds in a field: <img src="neko.png"> and [sound:neko.mp3]. */
export function fieldMedia(html: string): string[] {
  const names = [
    ...[...html.matchAll(/<img[^>]*?\ssrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi)].map((m) => m[1] ?? m[2] ?? m[3]),
    ...[...html.matchAll(/\[sound:([^\]]+)\]/g)].map((m) => m[1]),
  ];
  return names.map((n) => cleanField(n)).filter(Boolean);
}

export const isSound = (name: string) => /\.(mp3|m4a|aac|ogg|oga|opus|wav|webm|flac)$/i.test(name);

/**
 * Which card templates ask front → back and which ask back → front (Anki's reversed card),
 * from the fields each template's question shows. Others (e.g. listening-only) are left out.
 */
export function templateDirections(type: AnkiNoteType, roles: Roles): Map<number, Direction> {
  const out = new Map<number, Direction>();
  const front = type.fields[roles.front];
  const back = new Set(roles.back.map((i) => type.fields[i]));
  for (const t of type.templates) {
    // {{Field}}, {{furigana:Field}}, {{text:Field}}; not {{#Field}} sections or {{FrontSide}}.
    const shown = [...t.question.matchAll(/\{\{(?![#/^!])([^}]+)\}\}/g)].map((m) => m[1].split(':').pop()!.trim());
    if (shown.includes(front)) out.set(t.ord, 'recognition');
    else if (shown.some((f) => back.has(f))) out.set(t.ord, 'production');
  }
  return out;
}

/** Decides what each note becomes. Pure: nothing is written until applyImport. */
export function planImport(col: AnkiCollection, pack: Pack, opts: ImportOptions): ImportPlan {
  const { lang, now } = opts;
  const match = itemMatcher(pack);
  const cardsOf = new Map<string, AnkiCard[]>();
  for (const c of col.cards) cardsOf.set(c.noteId, [...(cardsOf.get(c.noteId) ?? []), c]);

  const plan: ImportPlan = { decks: [], notes: [], cards: [], media: [], matched: 0, matchedStudied: 0, custom: 0, reverse: 0, suspended: 0, empty: 0 };
  const builtIn = new Map<string, CardRecord>();
  const usedDecks = new Set<string>();
  const media = new Set<string>();
  const directions = new Map<string, Map<number, Direction>>();
  let order = 0;

  for (const note of col.notes) {
    const roles = opts.roles.get(note.typeId);
    const type = col.noteTypes.get(note.typeId);
    const cards = (cardsOf.get(note.id) ?? []).sort((a, b) => a.ord - b.ord);
    if (!roles || !type || !cards.length) continue;
    if (!directions.has(type.id)) directions.set(type.id, templateDirections(type, roles));
    const dirs = directions.get(type.id)!;
    // Without template info, the first card is taken as front → back.
    const card = dirs.size ? cards.find((c) => dirs.get(c.ord) === 'recognition') : cards[0];
    const reverseCard = cards.find((c) => dirs.get(c.ord) === 'production' && c.queue !== -1);
    if (!card || !opts.deckIds.has(card.deckId)) continue;
    if (card.queue === -1) {
      plan.suspended++;
      continue;
    }

    const frontHtml = note.fields[roles.front] ?? '';
    const backHtml = roles.back.map((i) => note.fields[i] ?? '');
    const front = ankiFurigana(cleanField(frontHtml));
    const readingField = roles.reading == null ? null : ankiFurigana(cleanField(note.fields[roles.reading] ?? ''));
    const back = backHtml.map((h) => ankiFurigana(cleanField(h)).plain).filter(Boolean).join('\n');
    const frontMedia = fieldMedia(frontHtml);
    const backMedia = backHtml.flatMap(fieldMedia);
    if ((!front.plain && !frontMedia.length) || (!back && !backMedia.length)) {
      plan.empty++;
      continue;
    }
    // Ruby for the front: from the front itself (日本[にほん]), a reading field with the same
    // text and furigana, or a plain kana reading of a single word.
    let ruby = front.markup;
    let readingKana: string | undefined;
    if (readingField?.plain) {
      if (readingField.markup && readingField.plain === front.plain) ruby = readingField.markup;
      else if (JAPANESE.test(readingField.plain) && !HAN.test(readingField.plain)) readingKana = readingField.plain;
      ruby ??= readingKana ? wordRuby(front.plain, readingKana) : undefined;
    }
    readingKana ??= ruby ? markupReading(ruby) : undefined;

    const schedule = opts.withProgress ? scheduleFromAnki(card, col.crt, now) : null;
    const reverseSchedule = opts.withProgress && reverseCard ? scheduleFromAnki(reverseCard, col.crt, now) : null;
    const item = opts.useBuiltIn && front.plain ? match(front.plain, readingKana) : null;
    if (item) {
      plan.matched++;
      if (schedule) plan.matchedStudied++;
      const keep = (rec: CardRecord) => {
        const prev = builtIn.get(rec.id);
        if (!prev || prev.reps < rec.reps) builtIn.set(rec.id, rec);
      };
      // Not studied yet: the app introduces it in its own order.
      if (schedule) keep({ ...newCard({ lang, direction: 'recognition', ...item }, now), ...schedule });
      // A reversed card is the app's "Say it in Japanese" card (words only).
      if (reverseSchedule && item.kind === 'vocab') keep({ ...newCard({ lang, direction: 'production', ...item }, now), ...reverseSchedule });
      continue;
    }

    plan.custom++;
    if (reverseCard) plan.reverse++;
    usedDecks.add(card.deckId);
    for (const m of [...frontMedia, ...backMedia]) media.add(m);
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
      ...(reverseCard ? { reverse: true } : {}),
      ...(frontMedia.length || backMedia.length ? { media: { front: frontMedia, back: backMedia } } : {}),
      createdAt: now,
      updatedAt: now,
    });
    const ref = { lang, kind: 'custom' as const, itemId: noteId, level: 0 };
    if (schedule) plan.cards.push({ ...newCard({ ...ref, direction: 'recognition' }, now), ...schedule });
    if (reverseSchedule) plan.cards.push({ ...newCard({ ...ref, direction: 'production' }, now), ...reverseSchedule });
  }

  plan.cards.push(...builtIn.values());
  plan.media = [...media];
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

/** What one side of a custom card shows besides text: picture and sound file names. */
export interface SideMedia {
  images: string[];
  sounds: string[];
}

const splitMedia = (names: string[] = []): SideMedia => ({ images: names.filter((n) => !isSound(n)), sounds: names.filter(isSound) });

/**
 * The flashcard for a note from an imported deck, asked front → back or, for reversed cards,
 * back → front. `question` and `answerMedia` list the pictures and sounds of each side; the
 * front's sounds play with the question only front → back (a listening card).
 */
export function customFace(note: NoteRecord, direction: Direction = 'recognition'): CardFace & { question: SideMedia; answerMedia: SideMedia } {
  const reading = note.reading ? markupReading(note.reading) : undefined;
  const front = splitMedia(note.media?.front);
  const back = splitMedia(note.media?.back);
  if (direction === 'production') {
    return {
      prompt: note.back,
      promptIsTarget: JAPANESE.test(note.back) && !JAPANESE.test(note.front),
      answer: note.front,
      reading: reading && reading !== note.front ? reading : undefined,
      speak: reading ?? note.front,
      meaning: note.back,
      question: { images: back.images, sounds: [] },
      answerMedia: { images: front.images, sounds: [...front.sounds, ...back.sounds] },
    };
  }
  return {
    prompt: note.front,
    promptIsTarget: JAPANESE.test(note.front) || (!note.front && front.sounds.length > 0),
    answer: note.back,
    reading: reading && reading !== note.front ? reading : undefined,
    speak: JAPANESE.test(note.front) ? (reading ?? note.front) : (note.back.split('\n').find((l) => JAPANESE.test(l)) ?? ''),
    meaning: note.back,
    question: front,
    answerMedia: { images: back.images, sounds: back.sounds.length ? back.sounds : front.sounds },
  };
}

/** Card id of a note's card. */
export const noteCardId = (lang: string, noteId: string, direction: Direction = 'recognition') => cardId(lang, 'custom', direction, noteId);

