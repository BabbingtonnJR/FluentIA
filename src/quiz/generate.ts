import { normReading, primaryVocabId, sameWord, studyVocab } from '../content/senses';
import type { Pack, VocabItem, KanjiItem } from '../content/types';

export type QuestionType = 'meaning' | 'reading' | 'listening' | 'kanji';

/**
 * review: only items the learner has studied, easiest first, with studied words as distractors.
 * challenge: tops up with unseen items from the enabled levels, to meet new words.
 */
export type QuizMode = 'review' | 'challenge';

export interface Question {
  type: QuestionType;
  /** Text shown as the question (empty for listening, where it is only spoken). */
  prompt: string;
  /** Japanese text to speak for this question, if any. */
  speak?: string;
  options: string[];
  /** What each option is, shown after answering so wrong options teach something too. */
  notes: string[];
  answer: number;
  /** Whether the options are Japanese text (for font and lang). */
  optionsJp: boolean;
  itemId: string;
}

type Rand = () => number;

function shuffle<T>(arr: T[], rand: Rand): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Picks `n` distinct distractor items whose value differs from the correct one. */
function distractors<T>(pool: T[], correct: string, value: (t: T) => string, n: number, rand: Rand): T[] {
  const seen = new Set([correct]);
  const out: T[] = [];
  for (const t of shuffle(pool, rand)) {
    const v = value(t);
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(t);
    if (out.length === n) break;
  }
  return out;
}

function withOptions<T>(item: T, others: T[], value: (t: T) => string, note: (t: T) => string, rand: Rand) {
  const all = shuffle([item, ...others], rand);
  return { options: all.map(value), notes: all.map(note), answer: all.indexOf(item) };
}

/** A random sample of `n` items, then in their original order (best known first). */
function sample<T>(items: T[], n: number, rand: Rand): T[] {
  const rank = new Map(items.map((t, i) => [t, i]));
  return shuffle(items, rand)
    .slice(0, n)
    .sort((a, b) => rank.get(a)! - rank.get(b)!);
}

const hasKanji = (s: string) => /\p{Script=Han}/u.test(s);
const kanjiMeaning = (k: KanjiItem) => k.meanings.slice(0, 2).join(', ');
const vocabNote = (x: VocabItem) => (x.word === x.reading ? x.meaning : `${x.reading} · ${x.meaning}`);

/** Below this many studied words a review quiz would be too short to be worth it. */
export const REVIEW_MIN = 4;

export interface QuizInput {
  pack: Pack;
  /** Vocab and kanji ids the learner has studied, best known first. */
  studiedVocab: string[];
  studiedKanji: string[];
  levels: number[];
  mode?: QuizMode;
  count?: number;
  rand?: Rand;
}

/**
 * Builds a mixed quiz. In challenge mode questions favour studied items and fill the gap with
 * items from the enabled levels; in review mode they use studied items only, best known first,
 * so a beginner is asked about words they have already seen.
 */
export function generateQuiz(input: QuizInput): Question[] {
  const { pack, levels, rand = Math.random } = input;
  const count = input.count ?? 10;
  const review = input.mode === 'review';

  const levelVocab = studyVocab(pack).filter((v) => levels.includes(v.level));
  const levelKanji = pack.kanji.filter((k) => levels.includes(k.level));
  // One question per written form, asked about the word's card (十, not each of its readings).
  const studiedV = [...new Set(input.studiedVocab.map((id) => primaryVocabId(pack, id)))]
    .map((id) => pack.vocabById.get(id))
    .filter((v): v is VocabItem => !!v);
  const studiedK = input.studiedKanji.map((id) => pack.kanjiById.get(id)).filter((k): k is KanjiItem => !!k);

  const vocabPool = review
    ? sample(studiedV, count * 2, rand)
    : shuffle(studiedV.length >= count ? studiedV : [...studiedV, ...shuffle(levelVocab, rand)], rand);
  const kanjiPool = review
    ? sample(studiedK, 3, rand)
    : shuffle(studiedK.length >= 3 ? studiedK : [...studiedK, ...shuffle(levelKanji, rand)], rand);

  // Familiar distractors are easier to tell apart; fall back to the same level when too few.
  // Another reading of the same word (十 とお for 十 じゅう), or another spelling of it (中身 / 中味),
  // would be a right answer, never a wrong one.
  const differs = (x: VocabItem, v: VocabItem) => !sameWord(x, v) && normReading(x.reading) !== normReading(v.reading);
  const vocabDistractors = (v: VocabItem) => {
    const known = studiedV.filter((x) => differs(x, v));
    return review && known.length >= 6 ? known : pack.vocab.filter((x) => x.level === v.level && differs(x, v));
  };
  const kanjiDistractors = (k: KanjiItem) => {
    const known = studiedK.filter((x) => x.id !== k.id);
    return review && known.length >= 6 ? known : pack.kanji.filter((x) => x.level === k.level && x.id !== k.id);
  };

  const questions: Question[] = [];
  const usedVocab = new Set<string>();
  let kanjiAsked = 0;
  // Review leads with meaning and listening, which are gentler than reading a kanji word.
  const types: QuestionType[] = review
    ? ['meaning', 'listening', 'meaning', 'reading', 'kanji']
    : ['meaning', 'reading', 'listening', 'meaning', 'kanji'];

  for (let i = 0; questions.length < count && i < count * 4; i++) {
    const type = types[i % types.length];
    if (type === 'kanji') {
      const k = kanjiPool[kanjiAsked];
      if (!k) continue;
      kanjiAsked++;
      const others = distractors(kanjiDistractors(k), kanjiMeaning(k), kanjiMeaning, 3, rand);
      if (others.length < 3) continue;
      questions.push({ type, prompt: k.id, ...withOptions(k, others, kanjiMeaning, (x) => x.id, rand), optionsJp: false, itemId: k.id });
      continue;
    }

    const v = vocabPool.find((x) => !usedVocab.has(x.id) && (type !== 'reading' || (hasKanji(x.word) && x.reading !== x.word)));
    if (!v) continue;
    const pool = vocabDistractors(v);
    if (type === 'meaning') {
      const others = distractors(pool, v.meaning, (x) => x.meaning, 3, rand);
      if (others.length < 3) continue;
      questions.push({ type, prompt: v.word, speak: v.reading, ...withOptions(v, others, (x) => x.meaning, (x) => (x.word === x.reading ? x.word : `${x.word} · ${x.reading}`), rand), optionsJp: false, itemId: v.id });
    } else if (type === 'reading') {
      // Prefer readings of similar length so the answer is not obvious by shape.
      const similar = pool.filter((x) => Math.abs(x.reading.length - v.reading.length) <= 1);
      const others = distractors(similar.length >= 3 ? similar : pool, v.reading, (x) => x.reading, 3, rand);
      if (others.length < 3) continue;
      questions.push({ type, prompt: v.word, speak: v.reading, ...withOptions(v, others, (x) => x.reading, (x) => `${x.word} · ${x.meaning}`, rand), optionsJp: true, itemId: v.id });
    } else {
      // Homophones would make a listening question ambiguous.
      const others = distractors(pool.filter((x) => x.reading !== v.reading), v.word, (x) => x.word, 3, rand);
      if (others.length < 3) continue;
      questions.push({ type, prompt: '', speak: v.reading, ...withOptions(v, others, (x) => x.word, vocabNote, rand), optionsJp: true, itemId: v.id });
    }
    usedVocab.add(v.id);
  }
  return questions;
}

export const QUESTION_TITLES: Record<QuestionType, string> = {
  meaning: 'What does this mean?',
  reading: 'How is this read?',
  listening: 'Which word did you hear?',
  kanji: 'What does this kanji mean?',
};
