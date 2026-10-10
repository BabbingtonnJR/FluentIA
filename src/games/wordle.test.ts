import { describe, expect, it } from 'vitest';
import type { VocabItem } from '../content/types';
import { makePack } from '../test/fixtures';
import { dailyWord, keyMarks, modifyLast, puzzleKana, scoreGuess, typingKana, validGuesses, wordleScore, wordleWords } from './wordle';

const item = (word: string, reading: string, level = 5): VocabItem => ({ id: `${word}|${reading}`, word, reading, meaning: word, level });

describe('scoreGuess', () => {
  it('marks hits, near misses and misses', () => {
    expect(scoreGuess('ともだち', 'ともだち')).toEqual(['hit', 'hit', 'hit', 'hit']);
    expect(scoreGuess('だちとも', 'ともだち')).toEqual(['near', 'near', 'near', 'near']);
    expect(scoreGuess('さかなや', 'ともだち')).toEqual(['miss', 'miss', 'miss', 'miss']);
  });

  it('only marks a repeated kana as often as it occurs', () => {
    // one か in the answer: the hit takes it, so the other か is a miss
    expect(scoreGuess('かかし', 'あかい')).toEqual(['miss', 'hit', 'miss']);
    expect(scoreGuess('ここのか', 'かこい')).toEqual(['miss', 'hit', 'miss', 'near']);
  });

  it('treats small kana as tiles of their own', () => {
    expect(scoreGuess('きって', 'きつね')).toEqual(['hit', 'miss', 'miss']);
  });
});

describe('words', () => {
  it('keeps single hiragana or katakana readings as hiragana', () => {
    expect(puzzleKana(item('先生', 'せんせい'))).toBe('せんせい');
    expect(puzzleKana(item('テレビ', 'テレビ'))).toBe('てれび');
    expect(puzzleKana(item('一日', 'いちにち; ついたち'))).toBeNull();
    expect(puzzleKana(item('～日', '～にち'))).toBeNull();
  });

  it('picks words of the right length and level, and the same daily word all day', () => {
    const pack = makePack({ 5: 0, 4: 0 }, { 5: 0, 4: 0 });
    pack.vocab.push(item('先生', 'せんせい'), item('学生', 'がくせい'), item('猫', 'ねこ'), item('友達', 'ともだち', 4));
    const words = wordleWords(pack, 5);
    expect(words.map((w) => w.kana)).toEqual(['せんせい', 'がくせい']);
    expect(validGuesses(pack).has('ともだち')).toBe(true);
    expect(dailyWord(words, '2026-10-10', 5)).toBe(dailyWord(words, '2026-10-10', 5));
  });
});

describe('typing', () => {
  it('converts romaji as it is typed', () => {
    expect(typingKana('neko')).toEqual({ kana: 'ねこ', pending: '' });
    expect(typingKana('nek')).toEqual({ kana: 'ね', pending: 'k' });
    expect(typingKana('sen')).toEqual({ kana: 'せ', pending: 'n' });
    expect(typingKana('sense')).toEqual({ kana: 'せんせ', pending: '' });
    expect(typingKana('ねこ')).toEqual({ kana: 'ねこ', pending: '' });
  });
});

describe('keyboard and score', () => {
  it('keeps the best mark per kana', () => {
    const marks = keyMarks(['かこい', 'あかい'], 'あかい');
    expect(marks.get('か')).toBe('hit');
    expect(marks.get('こ')).toBe('miss');
  });

  it('scores fewer guesses and hints higher', () => {
    expect(wordleScore(true, 1, 0)).toBe(6);
    expect(wordleScore(true, 3, 1)).toBe(3);
    expect(wordleScore(true, 6, 3)).toBe(1);
    expect(wordleScore(false, 6, 0)).toBe(0);
  });
});

describe('modifyLast', () => {
  it('toggles voicing, ぱ sounds and small kana like a phone keyboard', () => {
    expect(modifyLast('か', '゛')).toBe('が');
    expect(modifyLast('が', '゛')).toBe('か');
    expect(modifyLast('は', '゜')).toBe('ぱ');
    expect(modifyLast('ぱ', '゜')).toBe('は');
    expect(modifyLast('ば', '゜')).toBe('ぱ');
    expect(modifyLast('きつ', '小')).toBe('きっ');
    expect(modifyLast('きゃ', '小')).toBe('きや');
    expect(modifyLast('あ', '゛')).toBe('あ');
    expect(modifyLast('', '゛')).toBe('');
  });
});
