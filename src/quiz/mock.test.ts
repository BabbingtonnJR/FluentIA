import { describe, expect, it } from 'vitest';
import type { Sentence } from '../content/types';
import { makePack, seeded } from '../test/fixtures';
import { generateMock, likelyPass, scoreMock, SECTIONS, type MockQuestion } from './mock';

describe('generateMock', () => {
  const pack = makePack({ 5: 5, 4: 30 }, { 5: 0, 4: 0 }, { 4: 12 });
  // Give each grammar point its own cloze text so there are enough distractors.
  pack.grammar.forEach((g, i) => {
    g.examples = [{ r: `文${i}パターン${i}です`, e: `sentence ${i}`, c: [String(i).length + 1, String(i).length + 1 + `パターン${i}`.length] }];
  });
  // Each sentence uses one N4 word literally, e.g. "これは語40です。"
  const sentences: Sentence[] = pack.vocab
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v.level === 4)
    .map(({ v, i }) => ({ i: 100 + i, r: `これは${v.word}ですよね、きっと。`, e: `This is ${v.meaning}.`, w: [i], l: 4 }));
  const questions = generateMock({ pack, sentences, level: 4, rand: seeded(7) });

  it('fills every section up to its size', () => {
    for (const s of SECTIONS) {
      const n = questions.filter((q) => q.section === s.id).length;
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(s.count);
    }
  });

  it('always offers four distinct options including the answer', () => {
    for (const q of questions) {
      expect(new Set(q.options).size).toBe(q.options.length);
      expect(q.options.length).toBe(4);
      expect(q.answer).toBeGreaterThanOrEqual(0);
    }
  });

  it('marks the tested word in vocabulary prompts', () => {
    const reading = questions.find((q) => q.title.startsWith('How is'))!;
    const plain = reading.prompt!.markup;
    const [a, b] = reading.prompt!.mark!;
    expect(pack.vocab.some((v) => v.word === plain.slice(a, b))).toBe(true);
  });
});

describe('scoring', () => {
  const q = (section: MockQuestion['section']): MockQuestion => ({ section, title: '', options: ['a', 'b', 'c', 'd'], answer: 0, optionsJp: false });
  const qs = [q('vocab'), q('vocab'), q('grammar'), q('grammar'), q('reading'), q('listening')];

  it('counts correct answers per section', () => {
    const r = scoreMock(qs, [0, 1, 0, 0, null, 0]);
    expect(r.correct).toBe(4);
    expect(r.total).toBe(6);
    expect(r.sections.find((s) => s.section === 'vocab')).toEqual({ section: 'vocab', correct: 1, total: 2 });
  });

  it('needs the overall pass mark and every section minimum', () => {
    expect(likelyPass(4, scoreMock(qs, [0, 0, 0, 0, 0, 0]))).toBe(true);
    // 5/6 overall, but nothing right in listening
    expect(likelyPass(4, scoreMock(qs, [0, 0, 0, 0, 0, 1]))).toBe(false);
  });
});
