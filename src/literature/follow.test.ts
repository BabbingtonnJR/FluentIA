import { describe, expect, it } from 'vitest';
import type { LitBlock } from '../content/types';
import { chapterOf, chapters, LEAD_SECONDS, sentenceAt, TAIL_SECONDS, timeOf } from './follow';

const s = (text: string) => ({ r: text, w: [[text]] as [string][] });
const body: LitBlock[] = [{ h: '一' }, { s: [s('あいうえお'), s('かきくけこ')] }, { h: '二' }, { s: [s('さし'), s('すせそたちつてと')] }];

describe('follow along', () => {
  const list = chapters(body);
  const duration = LEAD_SECONDS + 100 + TAIL_SECONDS;

  it('splits sentences into chapters at the headings', () => {
    expect(list.map((c) => c.first)).toEqual([0, 2]);
    expect(list[1].offsets).toEqual([0, 2, 10]);
    expect(chapterOf(list, 3)).toBe(1);
  });

  it('estimates the sentence being read from the share of characters', () => {
    expect(sentenceAt(list[0], 0, duration)).toBe(0); // during the spoken notice
    expect(sentenceAt(list[0], LEAD_SECONDS + 60, duration)).toBe(1);
    expect(sentenceAt(list[1], LEAD_SECONDS + 10, duration)).toBe(2); // さし is 20% of chapter two
    expect(sentenceAt(list[1], LEAD_SECONDS + 30, duration)).toBe(3);
    expect(sentenceAt(list[1], duration, duration)).toBe(3);
  });

  it('seeks to where a sentence starts', () => {
    expect(timeOf(list[1], 2, duration)).toBe(LEAD_SECONDS);
    expect(timeOf(list[1], 3, duration)).toBe(LEAD_SECONDS + 20);
  });
});
