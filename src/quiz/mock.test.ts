import { describe, expect, it } from 'vitest';
import type { Sentence } from '../content/types';
import { makePack, seeded } from '../test/fixtures';
import { generateMock, likelyPass, scoreMock, SECTIONS, type MockExtras, type MockQuestion } from './mock';

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

describe('exam-style reading and listening', () => {
  const line = (say: string) => ({ s: { r: say, w: [] }, say });
  const extras: MockExtras = {
    dialogues: [
      {
        id: 'd1',
        level: 4,
        title: 't',
        titleEn: 't',
        situation: '',
        roles: [{ jp: 'A', en: 'A' }, { jp: 'B', en: 'B' }],
        lines: [{ who: 0, ...line('こんにちは') }, { who: 1, ...line('こんにちは') }],
        questions: [{ type: 'task', q: '何をしますか。', say: '何をしますか。', options: ['あ', 'い', 'う', 'え'], answer: 2 }],
      },
      {
        id: 'm1',
        level: 4,
        title: 't',
        titleEn: 't',
        situation: '',
        roles: [{ jp: 'A', en: 'A' }],
        lines: [{ who: 0, ...line('お知らせです') }],
        questions: [{ type: 'summary', q: '何の話ですか。', say: '何の話ですか。', options: ['か', 'き', 'く', 'け'], answer: 0 }],
      },
    ],
    responses: [
      { id: 'r1', level: 4, kind: 'reply', prompt: line('お先に失礼します'), good: line('お疲れさまでした'), bad: [line('いただきます'), line('ただいま')] },
      { id: 's1', level: 4, kind: 'situation', situation: 'You leave.', good: line('お邪魔しました'), bad: [line('お邪魔します'), line('いらっしゃい')] },
    ],
    passages: [
      {
        id: 'p1',
        level: 4,
        kind: 'short',
        title: 'メモ',
        titleEn: 'Note',
        paragraphs: [[{ r: '明日は休みです。', w: [] }]],
        en: ['Tomorrow is a holiday.'],
        chars: 8,
        questions: [
          { q: '明日は？', options: ['休み', '授業', '試験', '旅行'], answer: 0, why: '' },
          { q: 'だれが？', options: ['わたし', 'あなた', '先生', '友だち'], answer: 0, why: '' },
        ],
      },
    ],
  };
  const pack = makePack({ 5: 0, 4: 30 }, { 5: 0, 4: 0 }, { 4: 4 });
  const questions = generateMock({ pack, sentences: [], level: 4, extras, rand: seeded(3) });

  it('asks about passages with the passage shown', () => {
    const reading = questions.filter((q) => q.section === 'reading');
    expect(reading).toHaveLength(2);
    expect(reading.every((q) => q.passage?.id === 'p1')).toBe(true);
    expect(reading[0].options[reading[0].answer]).toBe('休み');
  });

  it('plays conversations and asks in the formats of the real test', () => {
    const listening = questions.filter((q) => q.section === 'listening');
    expect(listening.map((q) => q.part)).toEqual(['課題理解', '概要理解', '発話表現', '即時応答']);
    const task = listening[0];
    expect(task.script).toHaveLength(2);
    expect(task.script![1].alt).toBe(true);
    expect(task.options[task.answer]).toBe('う');
    const reply = listening[3];
    expect(reply.audioOptions).toBe(true);
    expect(reply.options).toHaveLength(3);
    expect(reply.options[reply.answer]).toBe('お疲れさまでした');
  });
});
