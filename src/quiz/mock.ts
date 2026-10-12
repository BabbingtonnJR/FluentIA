import type { GrammarExample, Pack, Sentence, VocabItem } from '../content/types';
import { allForms, alternativeForms, canBeRival } from '../content/grammar';
import { normReading, sameWord } from '../content/senses';
import { plainText } from '../reading/furigana';

export type MockSection = 'vocab' | 'grammar' | 'reading' | 'listening';

export const SECTIONS: { id: MockSection; label: string; jp: string; count: number }[] = [
  { id: 'vocab', label: 'Vocabulary', jp: '文字・語彙', count: 10 },
  { id: 'grammar', label: 'Grammar', jp: '文法', count: 10 },
  { id: 'reading', label: 'Reading', jp: '読解', count: 5 },
  { id: 'listening', label: 'Listening', jp: '聴解', count: 5 },
];

/** One minute per question, like a compressed version of the real exam. */
export const SECONDS_PER_QUESTION = 60;

export interface MockQuestion {
  section: MockSection;
  /** Instruction shown above the question. */
  title: string;
  /** Japanese sentence with furigana markup, and the span to highlight or blank out. */
  prompt?: { markup: string; mark?: [number, number]; blank?: boolean; furigana: boolean };
  /** Text read aloud (listening). */
  speak?: string;
  options: string[];
  answer: number;
  optionsJp: boolean;
  /** Other forms that would fill the blank just as well, shown in the review. */
  also?: string[];
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

/** How alike two options look: shared characters count most, then similar length. */
function likeness(a: string, b: string): number {
  const chars = new Set(b);
  const shared = [...new Set(a)].filter((c) => chars.has(c)).length;
  return shared * 2 - Math.abs(a.length - b.length);
}

/**
 * Three distinct wrong options. With `alike`, the most similar-looking candidates win (as on the
 * real exam, where wrong readings and spellings look close to the right one); otherwise options
 * close in length are preferred.
 */
function pickDistractors(correct: string, pool: string[], rand: Rand, alike = false): string[] {
  const seen = new Set([correct]);
  const score = (v: string) => (alike ? likeness(v, correct) : -Math.abs(v.length - correct.length));
  // Keep some randomness among the top candidates so mocks don't repeat the same distractors.
  const ranked = shuffle(pool, rand)
    .map((v) => ({ v, s: score(v) + rand() }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.v);
  const out: string[] = [];
  for (const v of ranked) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length === 3) break;
  }
  return out;
}

function withOptions(correct: string, pool: string[], rand: Rand, alike = false) {
  const options = shuffle([correct, ...pickDistractors(correct, pool, rand, alike)], rand);
  return { options, answer: options.indexOf(correct) };
}

const hasKanji = (s: string) => /\p{Script=Han}/u.test(s);
/** Word-list entries like 「はあ (かん)」 or 「～語」 make poor answer options. */
const cleanWord = (s: string) => !!s && !/[\s()（）～~;、A-Za-z]/.test(s);
const firstReading = (v: VocabItem) => v.reading.split(/[;、]/)[0].trim();

export interface MockInput {
  pack: Pack;
  sentences: Sentence[];
  level: number;
  rand?: Rand;
}

/**
 * Builds a short JLPT-style mock for one level: vocabulary (kanji reading, spelling, words
 * in context), grammar (fill in the blank), reading and listening comprehension. Everything
 * is drawn from that level so it measures the level, not just what has been studied.
 */
export function generateMock({ pack, sentences, level, rand = Math.random }: MockInput): MockQuestion[] {
  const levelVocab = pack.vocab.filter((v) => v.level === level && cleanWord(v.word));
  const levelSentences = shuffle(
    sentences.filter((s) => s.l === level),
    rand,
  );
  const out: MockQuestion[] = [];

  // --- 文字・語彙 ---------------------------------------------------------------
  // A word from this level used literally in a sentence of this level.
  const used = new Set<number>();
  const inContext: { v: VocabItem; s: Sentence; at: number }[] = [];
  for (const s of levelSentences) {
    const plain = plainText(s.r);
    for (const w of s.w) {
      const v = pack.vocab[w];
      if (!v || v.level !== level || used.has(w) || !cleanWord(v.word)) continue;
      const at = plain.indexOf(v.word);
      if (at < 0) continue;
      used.add(w);
      inContext.push({ v, s, at });
      break;
    }
    if (inContext.length >= 20) break;
  }
  const withKanji = inContext.filter((x) => hasKanji(x.v.word) && firstReading(x.v) !== x.v.word);
  // Wrong options must be wrong: never another reading of the same word (十: じゅう / とお) or
  // another spelling of it (中身 / 中味).
  const othersThan = (v: VocabItem) => levelVocab.filter((x) => !sameWord(x, v) && normReading(x.reading) !== normReading(v.reading));
  const readingsBesides = (v: VocabItem) => othersThan(v).map(firstReading).filter(cleanWord);

  // 漢字読み: how is the underlined word read?
  for (const { v, s, at } of withKanji.slice(0, 4)) {
    out.push({
      section: 'vocab',
      title: 'How is the underlined word read?',
      prompt: { markup: s.r, mark: [at, at + v.word.length], furigana: false },
      ...withOptions(firstReading(v), readingsBesides(v), rand, true),
      optionsJp: true,
    });
  }
  // 表記: which kanji spelling is right for the underlined word?
  for (const { v, s, at } of withKanji.slice(4, 7)) {
    const reading = firstReading(v);
    const plain = plainText(s.r);
    out.push({
      section: 'vocab',
      title: 'Which is the correct way to write the underlined word?',
      prompt: { markup: plain.slice(0, at) + reading + plain.slice(at + v.word.length), mark: [at, at + reading.length], furigana: false },
      ...withOptions(
        v.word,
        othersThan(v).filter((x) => hasKanji(x.word)).map((x) => x.word),
        rand,
        true,
      ),
      optionsJp: true,
    });
  }
  // 文脈規定: which word fits the blank?
  const shown = new Set(withKanji.slice(0, 7));
  // Short sentences leave too many words that would fit, so context questions need some length.
  const contextual = inContext.filter((x) => !shown.has(x) && plainText(x.s.r).length >= 12);
  for (const { v, s, at } of contextual.slice(0, 10 - out.length)) {
    out.push({
      section: 'vocab',
      title: 'Which word best fits the blank?',
      prompt: { markup: s.r, mark: [at, at + v.word.length], blank: true, furigana: true },
      ...withOptions(v.word, othersThan(v).map((x) => x.word), rand),
      optionsJp: true,
    });
  }

  // --- 文法 -------------------------------------------------------------------
  const points = shuffle(
    pack.grammar.filter((g) => g.level === level),
    rand,
  );
  const clozeText = (ex: GrammarExample) => plainText(ex.r).slice(ex.c[0], ex.c[1]);
  for (const g of points.slice(0, 10)) {
    // Own examples first: they were written to show the pattern clearly.
    const own = g.examples.filter((e) => !e.i);
    const ex = shuffle(own.length ? own : g.examples, rand)[0];
    const correct = clozeText(ex);
    // Wrong options come from points that don't mean the same (not ので for から), and are none of
    // this point's own forms (not じゃありません for じゃないです).
    const forms = new Set([...g.examples.map(clozeText), ...allForms(g)]);
    const others = points.filter((p) => canBeRival(g, p)).flatMap((p) => p.examples.map(clozeText)).filter((c) => !forms.has(c));
    const also = alternativeForms(g, correct, plainText(ex.r).slice(0, ex.c[0]));
    out.push({
      section: 'grammar',
      title: 'Which expression best fits the blank?',
      prompt: { markup: ex.r, mark: ex.c, blank: true, furigana: true },
      ...withOptions(correct, others, rand),
      optionsJp: true,
      ...(also.length ? { also } : {}),
    });
  }

  // --- 読解 / 聴解 --------------------------------------------------------------
  const contextIds = new Set(inContext.map((x) => x.s.i));
  const longer = levelSentences.filter((s) => !contextIds.has(s.i) && plainText(s.r).length >= 12);
  const translations = levelSentences.map((s) => s.e);
  for (const s of longer.slice(0, 5)) {
    out.push({
      section: 'reading',
      title: 'What does this sentence mean?',
      prompt: { markup: s.r, furigana: true },
      ...withOptions(s.e, translations, rand),
      optionsJp: false,
    });
  }
  for (const s of longer.slice(5, 10)) {
    out.push({
      section: 'listening',
      title: 'Listen. What did you hear?',
      speak: plainText(s.r),
      ...withOptions(s.e, translations, rand),
      optionsJp: false,
    });
  }

  // A question without three plausible distractors would be too easy to guess.
  return out.filter((q) => q.options.length === 4);
}

export interface SectionScore {
  section: MockSection;
  correct: number;
  total: number;
}

/** Overall pass mark and per-section minimum, after the real JLPT (N4 90/180, N3 95/180, sections ≥ about 1/3). */
export const PASS_MARK: Record<number, number> = { 5: 0.44, 4: 0.5, 3: 0.53 };
export const SECTION_MINIMUM = 0.32;

export function scoreMock(questions: MockQuestion[], picks: (number | null)[]) {
  const sections: SectionScore[] = SECTIONS.map(({ id }) => {
    const qs = questions.map((q, i) => ({ q, i })).filter(({ q }) => q.section === id);
    return { section: id, total: qs.length, correct: qs.filter(({ q, i }) => picks[i] === q.answer).length };
  }).filter((s) => s.total > 0);
  const correct = sections.reduce((n, s) => n + s.correct, 0);
  const total = sections.reduce((n, s) => n + s.total, 0);
  return { sections, correct, total };
}

export function likelyPass(level: number, result: ReturnType<typeof scoreMock>): boolean {
  if (!result.total) return false;
  return (
    result.correct / result.total >= (PASS_MARK[level] ?? 0.55) &&
    result.sections.every((s) => s.correct / s.total >= SECTION_MINIMUM)
  );
}
