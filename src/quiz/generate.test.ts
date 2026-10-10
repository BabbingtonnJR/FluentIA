import { describe, expect, it } from 'vitest';
import { makePack, seeded } from '../test/fixtures';
import { generateQuiz, REVIEW_MIN } from './generate';

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

  it('labels every option, so wrong ones can be explained after answering', () => {
    const qs = generateQuiz({ pack, studiedVocab: [], studiedKanji: [], levels: [5], rand: seeded(5) });
    for (const q of qs) {
      expect(q.notes).toHaveLength(q.options.length);
      if (q.type === 'meaning') expect(q.notes[q.answer]).toContain(pack.vocabById.get(q.itemId)!.word);
      if (q.type === 'kanji') expect(q.notes[q.answer]).toBe(q.itemId);
    }
  });
});

describe('review mode', () => {
  const pack = makePack({ 5: 30, 4: 30 }, { 5: 5, 4: 5 });
  const studied = pack.vocab.slice(0, 8).map((v) => v.id);

  it('only asks about studied items, with studied words as distractors', () => {
    const qs = generateQuiz({ pack, studiedVocab: studied, studiedKanji: [], levels: [5, 4], mode: 'review', rand: seeded(2) });
    expect(qs.length).toBeGreaterThanOrEqual(REVIEW_MIN);
    expect(qs.every((q) => q.type !== 'kanji' && studied.includes(q.itemId))).toBe(true);
    const studiedMeanings = new Set(studied.map((id) => pack.vocabById.get(id)!.meaning));
    for (const q of qs.filter((q) => q.type === 'meaning')) expect(q.options.every((o) => studiedMeanings.has(o))).toBe(true);
  });

  it('starts with the best known items', () => {
    const qs = generateQuiz({ pack, studiedVocab: studied, studiedKanji: [], levels: [5], mode: 'review', count: 4, rand: seeded(9) });
    const order = qs.map((q) => studied.indexOf(q.itemId));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('returns nothing to ask without studied items', () => {
    expect(generateQuiz({ pack, studiedVocab: [], studiedKanji: [], levels: [5], mode: 'review', rand: seeded() })).toHaveLength(0);
  });
});
