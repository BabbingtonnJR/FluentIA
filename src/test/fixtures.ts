import type { GrammarPoint, KanjiItem, Pack, VocabItem } from '../content/types';

export function makePack(
  vocabCount = { 5: 10, 4: 10 },
  kanjiCount = { 5: 3, 4: 3 },
  grammarCount: Record<number, number> = {},
): Pack {
  const vocab: VocabItem[] = [];
  const kanji: KanjiItem[] = [];
  const grammar: GrammarPoint[] = [];
  for (const [level, n] of Object.entries(grammarCount)) {
    for (let i = 0; i < n; i++) {
      grammar.push({
        id: `n${level}-g${i}`,
        level: Number(level),
        pattern: `〜g${i}`,
        meaning: `grammar ${level}-${i}`,
        formation: [],
        examples: [
          { r: `例${i}たら`, e: `example ${i}`, c: [2, 4] },
          { r: `文${i}たら`, e: `sentence ${i}`, c: [2, 4] },
        ],
      });
    }
  }
  for (const [level, n] of Object.entries(vocabCount)) {
    for (let i = 0; i < n; i++) {
      vocab.push({ id: `w${level}-${i}|r${level}-${i}`, word: `語${level}${i}`, reading: `よみ${level}の${i}`, meaning: `meaning ${level}-${i}`, level: Number(level) });
    }
  }
  const chars = '一二三四五六七八九十';
  let c = 0;
  for (const [level, n] of Object.entries(kanjiCount)) {
    for (let i = 0; i < n; i++) {
      kanji.push({ id: chars[c++], level: Number(level), meanings: [`kanji ${level}-${i}`], on: ['いち'], kun: ['ひと.つ'], strokes: 1, freq: c });
    }
  }
  return {
    manifest: {
      id: 'ja',
      name: 'Japanese',
      nativeName: '日本語',
      ttsLocale: 'ja-JP',
      levels: [5, 4].map((id) => ({ id, label: `N${id}` })),
      kinds: ['vocab', 'kanji'],
      counts: { vocab: vocab.length, kanji: kanji.length },
      builtAt: '2026-10-10',
    },
    vocab,
    kanji,
    grammar,
    vocabById: new Map(vocab.map((v) => [v.id, v])),
    kanjiById: new Map(kanji.map((k) => [k.id, k])),
    grammarById: new Map(grammar.map((g) => [g.id, g])),
  };
}

/** Deterministic pseudo-random generator for reproducible tests. */
export function seeded(seed = 42): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
