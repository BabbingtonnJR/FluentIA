import { describe, expect, it } from 'vitest';
import { bestMatch, compareSpoken, normalizeSpoken } from './record';
import { voiceQuality } from './tts';

describe('comparing what was said', () => {
  it('ignores punctuation, spaces and katakana vs hiragana', () => {
    expect(normalizeSpoken('はい、どうぞ。')).toBe('はいどうぞ');
    expect(normalizeSpoken('コーヒー 一つ')).toBe('こーひー一つ');
  });

  it('scores the share of the sentence that was heard', () => {
    expect(compareSpoken('お疲れさまでした。', 'お疲れさまでした').score).toBe(1);
    const partial = compareSpoken('お疲れさまでした', 'お疲れさま');
    expect(partial.score).toBeCloseTo(5 / 8);
    expect(partial.hit).toEqual([true, true, true, true, true, false, false, false]);
    expect(compareSpoken('いただきます', 'ごちそうさま').score).toBeLessThan(0.3);
  });

  it('takes the best guess against any accepted form', () => {
    const r = bestMatch(['十分ぐらいです', 'じゅっぷんぐらいです'], ['10分ぐらいです', 'じゅっぷんぐらいです']);
    expect(r).toEqual({ heard: 'じゅっぷんぐらいです', score: 1 });
  });
});

describe('voice quality', () => {
  it('prefers natural and enhanced voices over compact ones', () => {
    const q = (name: string) => voiceQuality({ name, localService: true });
    expect(q('Microsoft Nanami Online (Natural) - Japanese (Japan)')).toBeGreaterThan(q('Kyoko (Enhanced)'));
    expect(q('Kyoko (Enhanced)')).toBeGreaterThan(q('Kyoko'));
    expect(q('Kyoko')).toBeGreaterThan(q('Kyoko (Compact)'));
  });
});

describe('pitch accent', () => {
  it('splits kana into morae', async () => {
    const { morae } = await import('../components/Pitch');
    expect(morae('きょう')).toEqual(['きょ', 'う']);
    expect(morae('がっこう')).toEqual(['が', 'っ', 'こ', 'う']);
  });

  it('draws Tokyo pitch: low-high, a drop after the accent', async () => {
    const { pitchPattern } = await import('../components/Pitch');
    expect(pitchPattern(2, 1)).toEqual(['hi', 'lo']); // 箸 はし
    expect(pitchPattern(2, 2)).toEqual(['lo', 'hi']); // 橋 はし (drop after the word)
    expect(pitchPattern(3, 0)).toEqual(['lo', 'hi', 'hi']); // 桜 さくら, flat
    expect(pitchPattern(4, 2)).toEqual(['lo', 'hi', 'lo', 'lo']);
  });
});

describe('recording keys', () => {
  it('ignore spacing and a final full stop', async () => {
    const { textKey } = await import('./audio');
    expect(textKey('ええ、どうぞ。')).toBe(textKey('ええ、どうぞ'));
    expect(textKey('a b')).toBe('ab');
  });
});
