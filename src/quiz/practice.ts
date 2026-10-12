import type { GrammarExample, GrammarPoint, KanjiItem, Pack, Sentence, VocabItem } from '../content/types';
import { allForms, alternativeForms, canBeRival } from '../content/grammar';
import { normReading, sameWord } from '../content/senses';
import { plainText } from '../reading/furigana';

/** What the learner picked to practise. */
export type PracticeKind = 'grammar' | 'vocab' | 'kanji';
export interface PracticeItem {
  kind: PracticeKind;
  id: string;
}

export type PracticeType = 'grammar-cloze' | 'grammar-meaning' | 'word-meaning' | 'word-reading' | 'word-cloze' | 'kanji-meaning';

export const PRACTICE_TITLES: Record<PracticeType, string> = {
  'grammar-cloze': 'Which expression fits the blank?',
  'grammar-meaning': 'What does this pattern mean?',
  'word-meaning': 'What does this mean?',
  'word-reading': 'How is this read?',
  'word-cloze': 'Which word fits the blank?',
  'kanji-meaning': 'What does this kanji mean?',
};

export interface PracticeQuestion {
  type: PracticeType;
  item: PracticeItem;
  /** A sentence with furigana markup and the span that is blanked out. */
  sentence?: { markup: string; mark: [number, number]; english: string; tatoeba?: number };
  /** A word, kanji or pattern shown on its own. */
  text?: string;
  /** Japanese to read aloud after answering. */
  speak?: string;
  options: string[];
  /** What each option is, shown after answering, so the wrong ones teach too. */
  notes: string[];
  answer: number;
  optionsJp: boolean;
  /** Other forms that would fill the blank just as well (じゃないです → じゃありません), shown after answering. */
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

interface Option {
  text: string;
  note: string;
}

/** The right option and up to three wrong ones, shuffled. */
function options(correct: Option, wrong: Option[], rand: Rand) {
  const seen = new Set([correct.text]);
  const picked: Option[] = [];
  for (const o of wrong) {
    if (!o.text || seen.has(o.text)) continue;
    seen.add(o.text);
    picked.push(o);
    if (picked.length === 3) break;
  }
  const all = shuffle([correct, ...picked], rand);
  return { options: all.map((o) => o.text), notes: all.map((o) => o.note), answer: all.indexOf(correct) };
}

const clozeText = (ex: GrammarExample) => plainText(ex.r).slice(ex.c[0], ex.c[1]);
const grammarNote = (g: GrammarPoint) => `${g.pattern} · ${g.meaning}`;
const hasKanji = (s: string) => /\p{Script=Han}/u.test(s);
/** Word-list entries like 「はあ (かん)」 or 「～語」 make poor answer options. */
const cleanWord = (s: string) => !!s && !/[\s()（）～~;、A-Za-z]/.test(s);
const firstWord = (v: VocabItem) => v.word.split(/;\s*/)[0];
const wordNote = (v: VocabItem) => (v.word === v.reading ? v.meaning : `${v.reading} · ${v.meaning}`);
const kanjiMeaning = (k: KanjiItem) => k.meanings.slice(0, 2).join(', ');

export interface PracticeInput {
  pack: Pack;
  sentences: Sentence[];
  items: PracticeItem[];
  count: number;
  rand?: Rand;
}

type Maker = (used: Set<string>) => PracticeQuestion | null;

/**
 * A drill on exactly what the learner picked. Grammar blanks take their wrong options from the
 * other points picked first (telling ように from ために apart is the point), then from look-alike
 * points of nearby levels; words and kanji likewise prefer the other picked items.
 */
export function generatePractice({ pack, sentences, items, count, rand = Math.random }: PracticeInput): PracticeQuestion[] {
  const grammar = items.flatMap((i) => (i.kind === 'grammar' ? (pack.grammarById.get(i.id) ?? []) : []));
  const vocab = items.flatMap((i) => (i.kind === 'vocab' ? (pack.vocabById.get(i.id) ?? []) : []));
  const kanji = items.flatMap((i) => (i.kind === 'kanji' ? (pack.kanjiById.get(i.id) ?? []) : []));
  const vocabIndex = new Map(pack.vocab.map((v, i) => [v.id, i]));

  // --- Grammar ---------------------------------------------------------------------
  /** Wrong options for a blank: the other picked points, then look-alikes near its level, each in its closest form. */
  const grammarRivals = (g: GrammarPoint, correct: string): Option[] => {
    // Its form closest to the right answer; cut-off spans (ように言っ) don't make real options.
    const formOf = (p: GrammarPoint) =>
      p.examples
        .map(clozeText)
        .filter((t) => !/[っッ]$/.test(t))
        .sort((a, b) => likeness(b, correct) - likeness(a, correct))[0] ?? '';
    // Points that mean the same (から / ので) and the point's own other forms would also be right.
    const own = allForms(g);
    const picked = shuffle(grammar.filter((p) => canBeRival(g, p)), rand);
    const nearby = pack.grammar
      .filter((p) => canBeRival(g, p) && !grammar.includes(p) && Math.abs(p.level - g.level) <= 1)
      .map((p) => ({ p, s: likeness(formOf(p), correct) + rand() }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.p);
    return [...picked, ...nearby].map((p) => ({ text: formOf(p), note: grammarNote(p) })).filter((o) => !own.has(o.text));
  };

  const grammarCloze = (g: GrammarPoint, used: Set<string>): PracticeQuestion | null => {
    // The point's own examples first: they were written to show it clearly.
    const examples = [...shuffle(g.examples.filter((e) => !e.i), rand), ...shuffle(g.examples.filter((e) => e.i), rand)];
    const ex = examples.find((e) => !used.has(e.r));
    if (!ex) return null;
    used.add(ex.r);
    const correct = clozeText(ex);
    const also = alternativeForms(g, correct, plainText(ex.r).slice(0, ex.c[0]));
    const o = options({ text: correct, note: grammarNote(g) }, grammarRivals(g, correct).filter((x) => !also.includes(x.text)), rand);
    if (o.options.length < 2) return null;
    return {
      type: 'grammar-cloze',
      item: { kind: 'grammar', id: g.id },
      sentence: { markup: ex.r, mark: ex.c, english: ex.e, tatoeba: ex.i },
      speak: plainText(ex.r),
      ...o,
      optionsJp: true,
      ...(also.length ? { also } : {}),
    };
  };

  const grammarMeaning = (g: GrammarPoint, used: Set<string>): PracticeQuestion | null => {
    if (used.has(`meaning:${g.id}`)) return null;
    const others = [...shuffle(grammar.filter((p) => canBeRival(g, p)), rand), ...shuffle(pack.grammar.filter((p) => p.level === g.level && canBeRival(g, p)), rand)];
    const o = options({ text: g.meaning, note: g.pattern }, others.map((p) => ({ text: p.meaning, note: p.pattern })), rand);
    if (o.options.length < 4) return null;
    used.add(`meaning:${g.id}`);
    return { type: 'grammar-meaning', item: { kind: 'grammar', id: g.id }, text: g.pattern, ...o, optionsJp: false };
  };

  // --- Words -----------------------------------------------------------------------
  // Another reading or spelling of the word (十 とお, 中味 for 中身) would be right too, so it never is a wrong option.
  const differs = (x: VocabItem, v: VocabItem) => !sameWord(x, v) && normReading(x.reading) !== normReading(v.reading);
  const wordPool = (v: VocabItem) => [
    ...shuffle(vocab.filter((x) => differs(x, v)), rand),
    ...shuffle(pack.vocab.filter((x) => x.level === v.level && differs(x, v)), rand),
  ];

  const wordMeaning = (v: VocabItem, used: Set<string>): PracticeQuestion | null => {
    if (used.has(`meaning:${v.id}`)) return null;
    const o = options({ text: v.meaning, note: firstWord(v) }, wordPool(v).map((x) => ({ text: x.meaning, note: `${firstWord(x)} · ${x.reading}` })), rand);
    if (o.options.length < 4) return null;
    used.add(`meaning:${v.id}`);
    return { type: 'word-meaning', item: { kind: 'vocab', id: v.id }, text: v.word, speak: v.reading, ...o, optionsJp: false };
  };

  const wordReading = (v: VocabItem, used: Set<string>): PracticeQuestion | null => {
    if (!hasKanji(v.word) || v.word === v.reading || used.has(`reading:${v.id}`)) return null;
    const pool = wordPool(v)
      .filter((x) => cleanWord(x.reading))
      .map((x) => ({ x, s: likeness(x.reading, v.reading) + rand() }))
      .sort((a, b) => b.s - a.s)
      .map(({ x }) => ({ text: x.reading, note: `${firstWord(x)} · ${x.meaning}` }));
    const o = options({ text: v.reading, note: v.meaning }, pool, rand);
    if (o.options.length < 4) return null;
    used.add(`reading:${v.id}`);
    return { type: 'word-reading', item: { kind: 'vocab', id: v.id }, text: v.word, speak: v.reading, ...o, optionsJp: true };
  };

  const wordCloze = (v: VocabItem, used: Set<string>): PracticeQuestion | null => {
    const idx = vocabIndex.get(v.id);
    const word = firstWord(v);
    if (idx === undefined || !cleanWord(word)) return null;
    // A sentence that uses the word as written, among the easiest ones.
    const candidates = sentences
      .filter((x) => x.w.includes(idx) && !used.has(x.r) && plainText(x.r).includes(word))
      .sort((a, b) => b.l - a.l || a.r.length - b.r.length)
      .slice(0, 8);
    const pick = shuffle(candidates, rand)[0];
    if (!pick) return null;
    used.add(pick.r);
    const plain = plainText(pick.r);
    const start = plain.indexOf(word);
    const pool = wordPool(v)
      .filter((x) => cleanWord(firstWord(x)))
      .map((x) => ({ x, s: -Math.abs(firstWord(x).length - word.length) + rand() }))
      .sort((a, b) => b.s - a.s)
      .map(({ x }) => ({ text: firstWord(x), note: wordNote(x) }));
    const o = options({ text: word, note: wordNote(v) }, pool, rand);
    if (o.options.length < 4) return null;
    return {
      type: 'word-cloze',
      item: { kind: 'vocab', id: v.id },
      sentence: { markup: pick.r, mark: [start, start + word.length], english: pick.e, tatoeba: pick.i },
      speak: plain,
      ...o,
      optionsJp: true,
    };
  };

  const kanjiQuestion = (k: KanjiItem, used: Set<string>): PracticeQuestion | null => {
    if (used.has(`kanji:${k.id}`)) return null;
    const pool = [...shuffle(kanji.filter((x) => x.id !== k.id), rand), ...shuffle(pack.kanji.filter((x) => x.level === k.level && x.id !== k.id), rand)];
    const o = options({ text: kanjiMeaning(k), note: k.id }, pool.map((x) => ({ text: kanjiMeaning(x), note: x.id })), rand);
    if (o.options.length < 4) return null;
    used.add(`kanji:${k.id}`);
    return { type: 'kanji-meaning', item: { kind: 'kanji', id: k.id }, text: k.id, ...o, optionsJp: false };
  };

  // --- Rounds over the picked items ------------------------------------------------------
  // Each item cycles through its kinds of question; blanks come first since they test use, not recall.
  const makers: Maker[][] = [
    ...grammar.map((g): Maker[] => [(u) => grammarCloze(g, u), (u) => grammarMeaning(g, u)]),
    ...vocab.map((v): Maker[] => [(u) => wordCloze(v, u), (u) => wordMeaning(v, u), (u) => wordReading(v, u)]),
    ...kanji.map((k): Maker[] => [(u) => kanjiQuestion(k, u)]),
  ];
  const out: PracticeQuestion[] = [];
  const used = new Set<string>();
  const order = shuffle(makers, rand);
  for (let round = 0; out.length < count && round < 12; round++) {
    let added = false;
    for (const make of order) {
      if (out.length >= count) break;
      // This round's kind of question, or the item's others when it can't be made.
      for (let k = 0; k < make.length; k++) {
        const q = make[(round + k) % make.length](used);
        if (q) {
          out.push(q);
          added = true;
          break;
        }
      }
    }
    if (!added) break;
  }
  return out;
}
