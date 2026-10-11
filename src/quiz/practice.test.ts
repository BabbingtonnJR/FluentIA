import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GrammarPoint, KanjiItem, Pack, Sentence, VocabItem } from '../content/types';
import { rankBy, searcher } from '../lang/search';
import { plainText } from '../reading/furigana';
import { makePack, seeded } from '../test/fixtures';
import { generatePractice, type PracticeItem } from './practice';

const read = <T,>(f: string) => JSON.parse(readFileSync(`public/packs/ja/${f}.json`, 'utf8')) as T;
const vocab = read<VocabItem[]>('vocab');
const kanji = read<KanjiItem[]>('kanji');
const grammar = read<GrammarPoint[]>('grammar');
const sentences = read<Sentence[]>('sentences');
const pack: Pack = {
  ...makePack(),
  vocab,
  kanji,
  grammar,
  vocabById: new Map(vocab.map((v) => [v.id, v])),
  kanjiById: new Map(kanji.map((k) => [k.id, k])),
  grammarById: new Map(grammar.map((g) => [g.id, g])),
};

describe('finding what to practise', () => {
  it('finds grammar by romaji, kana and English', () => {
    const find = (q: string) => rankBy(pack.grammar, q, searcher(q).grammar).map((g) => g.id);
    expect(find('youni').slice(0, 4)).toEqual(expect.arrayContaining(['n4-youni', 'n4-younisuru', 'n4-youninaru']));
    expect(find('noyouni')).toContain('n3-youni-as');
    expect(find('ように')).toContain('n4-youni');
    expect(find('so that')).toContain('n4-youni');
  });
});

describe('generatePractice', () => {
  const items: PracticeItem[] = [
    { kind: 'grammar', id: 'n4-youni' },
    { kind: 'grammar', id: 'n4-tameni' },
    { kind: 'grammar', id: 'n3-youni-as' },
  ];

  it('drills the picked grammar, with the other picked points as wrong options', () => {
    const qs = generatePractice({ pack, sentences, items, count: 12, rand: seeded(3) });
    expect(qs).toHaveLength(12);
    expect(new Set(qs.map((q) => q.item.id))).toEqual(new Set(items.map((i) => i.id)));
    const blanks = qs.filter((q) => q.type === 'grammar-cloze');
    expect(blanks.length).toBeGreaterThan(5);
    for (const q of blanks) {
      // The blank is the point's own expression, and each option says which point it is.
      expect(plainText(q.sentence!.markup).slice(...q.sentence!.mark)).toBe(q.options[q.answer]);
      expect(new Set(q.options).size).toBe(q.options.length);
      expect(q.notes.every(Boolean)).toBe(true);
    }
    // The picked points show up as each other's wrong options.
    const notes = blanks.flatMap((q) => q.notes.filter((_, i) => i !== q.answer));
    expect(notes.some((n) => n.includes('ために'))).toBe(true);
    expect(notes.some((n) => n.includes('ように'))).toBe(true);
    expect(blanks.flatMap((q) => q.options).some((o) => /っ$/.test(o))).toBe(false);
  });

  it('drills words with blanks in real sentences, meanings and readings', () => {
    const words = ['会う|あう', '自転車|じてんしゃ', '晴れる|はれる'];
    const qs = generatePractice({ pack, sentences, items: words.map((id) => ({ kind: 'vocab', id })), count: 9, rand: seeded(5) });
    expect(qs.length).toBeGreaterThanOrEqual(6);
    expect(new Set(qs.map((q) => q.type))).toEqual(new Set(['word-cloze', 'word-meaning', 'word-reading']));
    for (const q of qs) expect(q.options).toHaveLength(4);
  });

  it('returns nothing without items', () => {
    expect(generatePractice({ pack, sentences, items: [], count: 10 })).toEqual([]);
  });
});
