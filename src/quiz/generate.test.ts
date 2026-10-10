import { describe, expect, it } from 'vitest';
import { makePack, seeded } from '../test/fixtures';
import { generateQuiz } from './generate';

describe('generateQuiz', () => {
  const pack = makePack({ 5: 30, 4: 30 }, { 5: 5, 4: 5 });

  it('builds the requested number of well-formed questions', () => {
    const qs = generateQuiz({ pack, studiedVocab: [], studiedKanji: [], levels: [5, 4], rand: seeded() });
    expect(qs).toHaveLength(10);
    for (const q of qs) {
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.answer).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(qs.map((q) => q.type))).toEqual(new Set(['meaning', 'reading', 'listening', 'kanji']));
  });

  it('puts the correct answer at the answer index', () => {
    const qs = generateQuiz({ pack, studiedVocab: [], studiedKanji: [], levels: [5], rand: seeded(7) });
    for (const q of qs) {
      if (q.type === 'meaning') expect(q.options[q.answer]).toBe(pack.vocabById.get(q.itemId)!.meaning);
      if (q.type === 'reading') expect(q.options[q.answer]).toBe(pack.vocabById.get(q.itemId)!.reading);
      if (q.type === 'listening') expect(q.options[q.answer]).toBe(pack.vocabById.get(q.itemId)!.word);
    }
  });

  it('asks about studied words when there are enough of them', () => {
    const studied = pack.vocab.filter((v) => v.level === 4).slice(0, 12).map((v) => v.id);
    const qs = generateQuiz({ pack, studiedVocab: studied, studiedKanji: [], levels: [5, 4], rand: seeded(3) });
    const vocabQs = qs.filter((q) => q.type !== 'kanji');
    expect(vocabQs.every((q) => studied.includes(q.itemId))).toBe(true);
  });
});
