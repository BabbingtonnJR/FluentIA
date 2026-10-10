import { describe, expect, it } from 'vitest';
import { kanaQuery, romajiToHiragana, toHiragana } from './romaji';

describe('romajiToHiragana', () => {
  it.each([
    ['matsu', 'まつ'],
    ['shinbun', 'しんぶん'],
    ['shimbun', 'しんぶん'], ['sempai', 'せんぱい'],
    ['kitte', 'きって'],
    ['matcha', 'まっちゃ'],
    ['konnichiwa', 'こんにちわ'],
    ["kan'i", 'かんい'],
    ['kyou', 'きょう'],
    ['tōkyō', 'とうきょう'],
    ['jisho', 'じしょ'],
    ['zyagaimo', 'じゃがいも'],
    ['sitsumon', 'しつもん'],
    ['ra-men', 'らーめん'],
    ['onna', 'おんな'],
  ])('%s → %s', (latin, kana) => {
    expect(romajiToHiragana(latin)).toBe(kana);
  });
});

describe('kanaQuery', () => {
  it('reads latin queries as romaji', () => {
    expect(kanaQuery('Matsu')).toEqual({ kana: 'まつ', partial: false });
    expect(kanaQuery('hon')).toEqual({ kana: 'ほん', partial: false });
  });

  it('drops a half-typed syllable while typing', () => {
    expect(kanaQuery('mats')).toEqual({ kana: 'ま', partial: true });
    expect(kanaQuery('k')).toBeNull();
  });

  it('normalises katakana to hiragana', () => {
    expect(kanaQuery('マツ')).toEqual({ kana: 'まつ', partial: false });
    expect(toHiragana('ショウ')).toBe('しょう');
  });
});
