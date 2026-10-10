import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { VocabItem } from '../content/types';
import { makePack, seeded } from '../test/fixtures';
import { crosswordScore, crosswordWords, generateCrossword, GRID_MAX, gridRuns, wordCells } from './crossword';

// The real word list, so the test also shows the generator fills a grid well.
const pack = makePack({ 5: 0, 4: 0 }, { 5: 0, 4: 0 });
pack.vocab.push(...(JSON.parse(readFileSync('public/packs/ja/vocab.json', 'utf8')) as VocabItem[]));

describe('generateCrossword', () => {
  for (const level of [5, 4, 3]) {
    for (const seed of [1, 2, 3]) {
      it(`builds a clean N${level} grid (seed ${seed})`, () => {
        const cw = generateCrossword(crosswordWords(pack, level), seeded(seed))!;
        expect(cw.words.length).toBeGreaterThanOrEqual(6);
        expect(cw.width).toBeLessThanOrEqual(GRID_MAX);
        expect(cw.height).toBeLessThanOrEqual(GRID_MAX);
        // Each answer is written in its cells…
        for (const w of cw.words) {
          wordCells(w).forEach(([r, c], i) => expect(cw.cells[r][c]).toBe(w.kana[i]));
          expect(w.item.level).toBe(level);
        }
        // …and the grid holds no stray words: its runs are exactly the answers.
        expect(gridRuns(cw).sort()).toEqual(cw.words.map((w) => w.kana.join('')).sort());
      });
    }
  }

  it('numbers start cells in reading order', () => {
    const cw = generateCrossword(crosswordWords(pack, 5), seeded(4))!;
    const starts = cw.words.map((w) => ({ n: w.number, pos: w.row * 100 + w.col }));
    for (const a of starts) for (const b of starts) if (a.n < b.n) expect(a.pos).toBeLessThan(b.pos);
  });

  it('is the same puzzle for the same seed', () => {
    const a = generateCrossword(crosswordWords(pack, 4), seeded(9));
    const b = generateCrossword(crosswordWords(pack, 4), seeded(9));
    expect(a).toEqual(b);
  });

  it('scores words minus reveals', () => {
    expect(crosswordScore(8, 0)).toBe(16);
    expect(crosswordScore(8, 3)).toBe(13);
    expect(crosswordScore(2, 9)).toBe(0);
  });
});
