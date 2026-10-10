import type { Pack, VocabItem, KanjiItem } from '../content/types';

export type QuestionType = 'meaning' | 'reading' | 'listening' | 'kanji';

export interface Question {
  type: QuestionType;
  /** Text shown as the question (empty for listening, where it is only spoken). */
  prompt: string;
  /** Japanese text to speak for this question, if any. */
  speak?: string;
  options: string[];
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

/** Picks `n` distinct distractor values that differ from the correct one. */
function distractors<T>(pool: T[], correct: string, value: (t: T) => string, n: number, rand: Rand): string[] {
  const seen = new Set([correct]);
  const out: string[] = [];
  for (const t of shuffle(pool, rand)) {
    const v = value(t);
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length === n) break;
  }
  return out;
}

function withOptions(correct: string, others: string[], rand: Rand) {
  const options = shuffle([correct, ...others], rand);
  return { options, answer: options.indexOf(correct) };
}

const hasKanji = (s: string) => /\p{Script=Han}/u.test(s);

export interface QuizInput {
  pack: Pack;
  /** Vocab and kanji ids the learner has studied; questions come from these first. */
  studiedVocab: string[];
  studiedKanji: string[];
  levels: number[];
  count?: number;
  rand?: Rand;
}

/**
 * Builds a mixed quiz. Questions favour studied items; if there are too few, items from
 * the enabled levels fill the gap. Distractors come from the same level so they are plausible.
 */
export function generateQuiz(input: QuizInput): Question[] {
  const { pack, levels, rand = Math.random } = input;
  const count = input.count ?? 10;

  const levelVocab = pack.vocab.filter((v) => levels.includes(v.level));
  const levelKanji = pack.kanji.filter((k) => levels.includes(k.level));
  const studiedV = input.studiedVocab.map((id) => pack.vocabById.get(id)).filter((v): v is VocabItem => !!v);
  const studiedK = input.studiedKanji.map((id) => pack.kanjiById.get(id)).filter((k): k is KanjiItem => !!k);

  const vocabPool = shuffle(studiedV.length >= count ? studiedV : [...studiedV, ...shuffle(levelVocab, rand)], rand);
  const kanjiPool = shuffle(studiedK.length >= 3 ? studiedK : [...studiedK, ...shuffle(levelKanji, rand)], rand);

  const sameLevelVocab = (v: VocabItem) => pack.vocab.filter((x) => x.level === v.level && x.id !== v.id);
  const sameLevelKanji = (k: KanjiItem) => pack.kanji.filter((x) => x.level === k.level && x.id !== k.id);

  const questions: Question[] = [];
  const usedVocab = new Set<string>();
  const types: QuestionType[] = ['meaning', 'reading', 'listening', 'meaning', 'kanji'];

  for (let i = 0; questions.length < count && i < count * 4; i++) {
    const type = types[i % types.length];
    if (type === 'kanji') {
      const k = kanjiPool[questions.filter((q) => q.type === 'kanji').length];
      if (!k) continue;
      const correct = k.meanings.slice(0, 2).join(', ');
      const others = distractors(sameLevelKanji(k), correct, (x) => x.meanings.slice(0, 2).join(', '), 3, rand);
      questions.push({ type, prompt: k.id, ...withOptions(correct, others, rand), optionsJp: false, itemId: k.id });
      continue;
    }

    const v = vocabPool.find((x) => !usedVocab.has(x.id) && (type !== 'reading' || (hasKanji(x.word) && x.reading !== x.word)));
    if (!v) continue;
    usedVocab.add(v.id);
    const pool = sameLevelVocab(v);
    if (type === 'meaning') {
      const others = distractors(pool, v.meaning, (x) => x.meaning, 3, rand);
      questions.push({ type, prompt: v.word, speak: v.reading, ...withOptions(v.meaning, others, rand), optionsJp: false, itemId: v.id });
    } else if (type === 'reading') {
      // Prefer readings of similar length so the answer is not obvious by shape.
      const similar = pool.filter((x) => Math.abs(x.reading.length - v.reading.length) <= 1);
      const others = distractors(similar.length >= 3 ? similar : pool, v.reading, (x) => x.reading, 3, rand);
      questions.push({ type, prompt: v.word, ...withOptions(v.reading, others, rand), optionsJp: true, itemId: v.id });
    } else {
      // Homophones would make a listening question ambiguous.
      const others = distractors(pool.filter((x) => x.reading !== v.reading), v.word, (x) => x.word, 3, rand);
      questions.push({ type, prompt: '', speak: v.reading, ...withOptions(v.word, others, rand), optionsJp: true, itemId: v.id });
    }
  }
  return questions;
}

export const QUESTION_TITLES: Record<QuestionType, string> = {
  meaning: 'What does this mean?',
  reading: 'How is this read?',
  listening: 'Which word did you hear?',
  kanji: 'What does this kanji mean?',
};
