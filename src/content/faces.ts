import type { Direction } from '../db/types';
import { plainText } from '../reading/furigana';
import { alternativeForms } from './grammar';
import { formatKun } from './packs';
import { kanjiReadings, normReading, vocabSenses, wordKey } from './senses';
import type { CardFace, ItemKind, Pack } from './types';

/**
 * `variant` picks between a grammar point's example sentences (Study passes the review
 * count), so each review shows the pattern in a different sentence.
 */
export function cardFace(pack: Pack, kind: ItemKind, direction: Direction, itemId: string, variant = 0): CardFace | null {
  if (kind === 'grammar') {
    const g = pack.grammarById.get(itemId);
    if (!g?.examples.length) return null;
    const example = g.examples[variant % g.examples.length];
    const plain = plainText(example.r);
    return {
      prompt: plain.slice(0, example.c[0]) + '＿＿' + plain.slice(example.c[1]),
      promptIsTarget: true,
      answer: `${g.pattern} — ${g.meaning}`,
      speak: plain,
      meaning: g.meaning,
      cloze: { example, pattern: g.pattern },
      alternatives: alternativeForms(g, plain.slice(example.c[0], example.c[1]), plain.slice(0, example.c[0])),
    };
  }

  if (kind === 'vocab') {
    // Words written the same way are one card with all their readings (十 じゅう / とお).
    const senses = vocabSenses(pack, itemId);
    const v = senses[0]?.item;
    if (!v) return null;
    const many = senses.length > 1;
    const word = many ? wordKey(v.word) : v.word;
    const readings = [...new Set(senses.map((s) => s.reading))].filter((r) => r !== word);
    const meaning = many ? senses.map((s) => s.meaning).join(' / ') : v.meaning;
    const face = {
      reading: readings.length ? readings.join('・') : undefined,
      speak: readings.length ? readings.join('、') : v.reading,
      meaning,
      senses: senses.map((s) => ({ reading: s.reading !== word ? s.reading : undefined, meaning: s.meaning, note: s.note, examples: s.examples })),
    };
    if (direction === 'production') return { prompt: meaning, promptIsTarget: false, answer: word, ...face };
    return { prompt: word, promptIsTarget: true, answer: meaning, ...face };
  }

  const k = pack.kanjiById.get(itemId);
  if (!k) return null;
  const meaning = k.meanings.slice(0, 3).join(', ');
  const { readings, rare } = kanjiReadings(pack, k);
  // Without word data, fall back to the dictionary's full reading lists.
  const details = readings.length
    ? []
    : [k.on.length ? `On: ${k.on.join('、')}` : '', k.kun.length ? `Kun: ${k.kun.map(formatKun).join('、')}` : ''].filter(Boolean);
  const speak = k.kun[0] ? formatKun(k.kun[0]).replace(/[()\-]/g, '') : (k.on[0] ?? k.id);
  const example = readings
    .flatMap((r) => r.words)
    .flatMap((w) => vocabSenses(pack, w.id).find((s) => s.item === w)?.examples ?? [])
    .find((x) => plainText(x.r).includes(k.id));
  return {
    prompt: k.id,
    promptIsTarget: true,
    answer: meaning,
    details,
    speak,
    meaning,
    kanjiReadings: readings.map((r) => ({
      reading: r.reading,
      words: r.words.map((w) => ({ word: wordKey(w.word), reading: normReading(w.reading), meaning: w.meaning })),
    })),
    rareReadings: rare,
    examples: example ? [example] : [],
  };
}
