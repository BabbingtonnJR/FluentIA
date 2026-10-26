import type { Dialogue, GrammarExample, Pack, Passage, QuickResponse, Sentence, VocabItem } from '../content/types';
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
  /** The word or grammar point asked about, for the mistake notebook. */
  item?: { kind: 'vocab' | 'grammar'; id: string };
  /** Reading: the passage the question is about (furigana markup, sentences per paragraph). */
  passage?: { id: string; title: string; paragraphs: string[][] };
  /** Listening: what is played before the question, line by line (alt: a second speaker). */
  script?: { say: string; alt: boolean }[];
  /** Listening: the options are only heard, as in 即時応答; they are shown as 1, 2, 3 until the review. */
  audioOptions?: boolean;
  /** Which part of the real exam this follows (課題理解, 即時応答…). */
  part?: string;
  /** Written for Fluentia with its own options, so it may have three instead of four. */
  authored?: boolean;
}

/** Content written for Fluentia that makes reading and listening questions like the real exam's. */
export interface MockExtras {
  dialogues?: Dialogue[];
  responses?: QuickResponse[];
  passages?: Passage[];
}

export const LISTENING_PARTS = {
  task: '課題理解',
  point: 'ポイント理解',
  summary: '概要理解',
  situation: '発話表現',
  reply: '即時応答',
} as const;

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
  extras?: MockExtras;
  rand?: Rand;
}

/**
 * Builds a short JLPT-style mock for one level: vocabulary (kanji reading, spelling, words
 * in context), grammar (fill in the blank), reading and listening comprehension. Everything
 * is drawn from that level so it measures the level, not just what has been studied.
 */
export function generateMock({ pack, sentences, level, extras = {}, rand = Math.random }: MockInput): MockQuestion[] {
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
      item: { kind: 'vocab', id: v.id },
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
      item: { kind: 'vocab', id: v.id },
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
      item: { kind: 'vocab', id: v.id },
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
      item: { kind: 'grammar', id: g.id },
    });
  }

  // --- 読解 / 聴解 --------------------------------------------------------------
  const readingCount = SECTIONS.find((x) => x.id === 'reading')!.count;
  const listeningCount = SECTIONS.find((x) => x.id === 'listening')!.count;
  const reading = passageQuestions(extras.passages ?? [], level, readingCount, rand);
  const listening = listeningQuestions(extras, level, listeningCount, rand);

  const contextIds = new Set(inContext.map((x) => x.s.i));
  const longer = levelSentences.filter((s) => !contextIds.has(s.i) && plainText(s.r).length >= 12);
  const translations = levelSentences.map((s) => s.e);
  out.push(...reading);
  // Short sentences fill in where there aren't enough passages or dialogues for the level.
  for (const s of longer.slice(0, readingCount - reading.length)) {
    out.push({
      section: 'reading',
      title: 'What does this sentence mean?',
      prompt: { markup: s.r, furigana: true },
      ...withOptions(s.e, translations, rand),
      optionsJp: false,
    });
  }
  out.push(...listening);
  for (const s of longer.slice(readingCount, readingCount + listeningCount - listening.length)) {
    out.push({
      section: 'listening',
      title: 'Listen. What did you hear?',
      speak: plainText(s.r),
      ...withOptions(s.e, translations, rand),
      optionsJp: false,
    });
  }

  // A question without three plausible distractors would be too easy to guess.
  return out.filter((q) => q.options.length === 4 || (q.authored && q.options.length >= 3));
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

/** Shuffles options and keeps track of the right one. */
function shuffled(options: string[], answer: number, rand: Rand) {
  const order = shuffle(options.map((_, i) => i), rand);
  return { options: order.map((i) => options[i]), answer: order.indexOf(answer) };
}

const READING_PART: Record<Passage['kind'], string> = { short: '内容理解（短文）', mid: '内容理解（中文）', info: '情報検索' };

/** Reading questions from passages of the level (all of a passage's questions together, as on the exam). */
export function passageQuestions(passages: Passage[], level: number, count: number, rand: Rand): MockQuestion[] {
  const out: MockQuestion[] = [];
  for (const p of shuffle(passages.filter((x) => x.level === level), rand)) {
    if (out.length + p.questions.length > count) continue;
    const passage = { id: p.id, title: p.title, paragraphs: p.paragraphs.map((para) => para.map((s) => s.r)) };
    for (const q of p.questions) {
      out.push({ section: 'reading', title: q.q, passage, ...shuffled(q.options, q.answer, rand), optionsJp: true, part: READING_PART[p.kind], authored: true });
    }
  }
  return out;
}

/**
 * Listening questions in the formats of the real test: a conversation and a question on what
 * someone will do (課題理解) or a detail (ポイント理解), a monologue's gist (概要理解), what to
 * say in a situation (発話表現) and a quick reply (即時応答), whose options are only heard.
 */
export function listeningQuestions({ dialogues = [], responses = [] }: MockExtras, level: number, count: number, rand: Rand): MockQuestion[] {
  const out: MockQuestion[] = [];
  const atLevel = <T extends { level: number }>(items: T[]) => {
    const exact = items.filter((x) => x.level === level);
    return shuffle(exact.length ? exact : items.filter((x) => Math.abs(x.level - level) === 1), rand);
  };
  const scriptOf = (d: Dialogue) => d.lines.map((l) => ({ say: l.say, alt: l.who % 2 === 1 }));
  const conversations = atLevel(dialogues.filter((d) => d.roles.length > 1));
  const monologues = atLevel(dialogues.filter((d) => d.roles.length === 1));

  const fromDialogue = (d: Dialogue | undefined, type: 'task' | 'point' | 'summary') => {
    const q = d?.questions.find((x) => x.type === type) ?? (type !== 'summary' ? d?.questions[0] : undefined);
    if (!d || !q) return;
    out.push({
      section: 'listening',
      title: q.q,
      script: scriptOf(d),
      speak: q.say,
      ...shuffled(q.options, q.answer, rand),
      optionsJp: true,
      part: LISTENING_PARTS[q.type],
      authored: true,
    });
  };
  fromDialogue(conversations[0], 'task');
  fromDialogue(conversations[1], 'point');
  fromDialogue(monologues[0], 'summary');

  const replies = atLevel(responses);
  const situation = replies.find((r) => r.kind === 'situation');
  if (situation) {
    out.push({
      section: 'listening',
      title: `${situation.situation} What do you say?`,
      script: [],
      ...shuffled([situation.good.say, ...situation.bad.map((b) => b.say)], 0, rand),
      optionsJp: true,
      audioOptions: true,
      part: LISTENING_PARTS.situation,
      authored: true,
    });
  }
  for (const r of replies.filter((x) => x.kind === 'reply')) {
    if (out.length >= count) break;
    out.push({
      section: 'listening',
      title: 'Listen and choose the best reply.',
      script: [{ say: r.prompt!.say, alt: true }],
      ...shuffled([r.good.say, ...r.bad.map((b) => b.say)], 0, rand),
      optionsJp: true,
      audioOptions: true,
      part: LISTENING_PARTS.reply,
      authored: true,
    });
  }
  return out.slice(0, count);
}
