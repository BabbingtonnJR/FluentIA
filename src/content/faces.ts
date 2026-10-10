import type { Direction } from '../db/types';
import { formatKun } from './packs';
import type { CardFace, ItemKind, Pack } from './types';

export function cardFace(pack: Pack, kind: ItemKind, direction: Direction, itemId: string): CardFace | null {
  if (kind === 'vocab') {
    const v = pack.vocabById.get(itemId);
    if (!v) return null;
    const reading = v.reading !== v.word ? v.reading : undefined;
    if (direction === 'production') {
      return { prompt: v.meaning, promptIsTarget: false, answer: v.word, reading, speak: v.reading, meaning: v.meaning };
    }
    return { prompt: v.word, promptIsTarget: true, answer: v.meaning, reading, speak: v.reading, meaning: v.meaning };
  }

  const k = pack.kanjiById.get(itemId);
  if (!k) return null;
  const meaning = k.meanings.slice(0, 3).join(', ');
  const details = [
    k.on.length ? `On: ${k.on.join('、')}` : '',
    k.kun.length ? `Kun: ${k.kun.map(formatKun).join('、')}` : '',
  ].filter(Boolean);
  const speak = k.kun[0] ? formatKun(k.kun[0]).replace(/[()\-]/g, '') : (k.on[0] ?? k.id);
  return { prompt: k.id, promptIsTarget: true, answer: meaning, details, speak, meaning };
}
