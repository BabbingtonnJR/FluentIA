import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FluentiaDB } from '../db/db';
import { buildSession, withoutDuplicateReadings } from '../db/repo';
import { DEFAULT_SETTINGS } from '../db/types';
import { plainText } from '../reading/furigana';
import { generateMock } from '../quiz/mock';
import { generatePractice } from '../quiz/practice';
import { newCard } from '../srs/scheduler';
import { seeded } from '../test/fixtures';
import { cardFace } from './faces';
import { alternativeForms, canBeRival } from './grammar';
import { normReading, primaryVocabId, sameWord, studyVocab, vocabSenses, wordKey } from './senses';
import type { GrammarPoint, KanjiItem, Pack, PackExamples, Sentence, VocabItem } from './types';

/** The real Japanese pack, as the app loads it. */
function realPack(): Pack {
  const read = <T,>(f: string) => JSON.parse(readFileSync(`public/packs/ja/${f}`, 'utf8')) as T;
  const vocab = read<VocabItem[]>('vocab.json');
  const kanji = read<KanjiItem[]>('kanji.json');
  const grammar = read<GrammarPoint[]>('grammar.json');
  return {
    manifest: read('manifest.json'),
    vocab,
    kanji,
    grammar,
    examples: read<PackExamples>('examples.json'),
    vocabById: new Map(vocab.map((v) => [v.id, v])),
    kanjiById: new Map(kanji.map((k) => [k.id, k])),
    grammarById: new Map(grammar.map((g) => [g.id, g])),
  };
}

const pack = realPack();
const sentences = JSON.parse(readFileSync('public/packs/ja/sentences.json', 'utf8')) as Sentence[];

describe('words written the same way', () => {
  it('are one study card', () => {
    const keys = studyVocab(pack).map((v) => wordKey(v.word));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k === '十')).toHaveLength(1);
    expect(keys.filter((k) => k === '中')).toHaveLength(1);
  });

  it('show every reading with when it is used, and examples for each', () => {
    const ten = vocabSenses(pack, '十|(〜を) とお');
    expect(ten.map((s) => s.reading)).toEqual(['じゅう', 'とお']);
    for (const s of ten) {
      expect(s.note).toBeTruthy();
      expect(s.examples.length).toBeGreaterThan(0);
    }
    const middle = vocabSenses(pack, '中|なか').map((s) => s.reading);
    expect(middle).toEqual(expect.arrayContaining(['じゅう', 'ちゅう', 'なか']));
    const face = cardFace(pack, 'vocab', 'recognition', primaryVocabId(pack, '中|なか'))!;
    expect(face.prompt).toBe('中');
    expect(face.reading).toContain('じゅう');
  });

  it('every word card has an example sentence for each reading', () => {
    const without = studyVocab(pack).filter((v) => !cardFace(pack, 'vocab', 'recognition', v.id)!.senses!.every((s) => s.examples.length));
    expect(without.map((v) => v.id)).toEqual([]);
  });

  it('kanji cards list the words for each reading, with rare readings apart', () => {
    const face = cardFace(pack, 'kanji', 'recognition', '十')!;
    const toh = face.kanjiReadings!.find((r) => r.reading === 'とお')!;
    expect(toh.words.map((w) => w.word)).toContain('十日');
    expect(face.rareReadings).toContain('と');
  });

  it('cards studied as separate readings are not shown twice', () => {
    const a = newCard({ lang: 'ja', kind: 'vocab', direction: 'recognition', itemId: '十|じゅう', level: 5 }, 0);
    const b = newCard({ lang: 'ja', kind: 'vocab', direction: 'recognition', itemId: '十|(〜を) とお', level: 5 }, 0);
    expect(withoutDuplicateReadings(pack, [a, b]).map((c) => c.itemId)).toEqual(['十|じゅう']);
    // Studied only under its second reading, the card stays and shows the whole word.
    expect(withoutDuplicateReadings(pack, [b])).toEqual([b]);
  });

  it('a new session never introduces a word already studied under another reading', async () => {
    const d = new FluentiaDB(`senses-${Math.random()}`);
    await d.cards.put(newCard({ lang: 'ja', kind: 'vocab', direction: 'recognition', itemId: '十|(〜を) とお', level: 5 }, 0));
    const { queue } = await buildSession(pack, { ...DEFAULT_SETTINGS, levels: [5], newPerDay: 400 }, Date.now(), d);
    const fresh = queue.flatMap((e) => (e.type === 'new' && e.ref.kind === 'vocab' ? [e.ref.itemId] : []));
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.filter((id) => wordKey(pack.vocabById.get(id)!.word) === '十')).toEqual([]);
  });
});

describe('grammar forms that fit the same blank', () => {
  const janai = pack.grammarById.get('n5-janai')!;

  it('lists every form, so じゃありません is right where じゃないです is', () => {
    expect(janai.pattern).toContain('じゃありません');
    expect(alternativeForms(janai, 'じゃないです')).toEqual(expect.arrayContaining(['じゃありません', 'ではありません', 'ではないです']));
    expect(alternativeForms(janai, 'じゃない')).toEqual(['ではない']);
  });

  it('skips forms that do not fit after the text before the blank', () => {
    const naide = pack.grammarById.get('n4-naide')!;
    expect(alternativeForms(naide, 'ないで', '傘を持た')).toEqual(['ずに']);
    expect(alternativeForms(naide, 'ないで', '宿題をし')).toEqual([]);
  });

  it('never offers a form of the same point, or of a point that means the same, as a wrong option', () => {
    const items = pack.grammar.filter((g) => g.level === 5).map((g) => ({ kind: 'grammar' as const, id: g.id }));
    for (let seed = 1; seed <= 30; seed++) {
      for (const q of generatePractice({ pack, sentences, items, count: 40, rand: seeded(seed) })) {
        if (q.type !== 'grammar-cloze') continue;
        const g = pack.grammarById.get(q.item.id)!;
        const forms = (g.variants ?? []).flat().map((f) => f.split('|!')[0]);
        for (const w of q.options.filter((_, i) => i !== q.answer)) expect(forms).not.toContain(w);
      }
    }
    expect(canBeRival(pack.grammarById.get('n5-kara-reason')!, pack.grammarById.get('n4-node')!)).toBe(false);
  });
});

describe('mock test options', () => {
  it('never offer another reading or spelling of the asked word as wrong', () => {
    for (const level of [5, 4, 3]) {
      for (let seed = 1; seed <= 10; seed++) {
        for (const q of generateMock({ pack, sentences, level, rand: seeded(seed) })) {
          if (q.section !== 'vocab' || !q.prompt?.mark || q.prompt.blank) continue;
          const wrong = q.options.filter((_, i) => i !== q.answer);
          if (q.title.startsWith('How is')) {
            const word = plainText(q.prompt.markup).slice(...q.prompt.mark);
            const readings = pack.vocab.filter((v) => wordKey(v.word) === wordKey(word)).map((v) => normReading(v.reading));
            for (const w of wrong) expect(readings).not.toContain(normReading(w));
          } else {
            const entry = pack.vocab.find((v) => v.word === q.options[q.answer])!;
            for (const w of wrong) {
              const other = pack.vocab.find((v) => v.word === w)!;
              expect(sameWord(entry, other)).toBe(false);
              expect(normReading(other.reading)).not.toBe(normReading(entry.reading));
            }
          }
        }
      }
    }
  });
});
