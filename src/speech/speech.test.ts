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
