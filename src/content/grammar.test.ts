import { describe, expect, it } from 'vitest';
import { splitAt } from '../components/Ruby';
import { parseRuby } from '../reading/furigana';
import { selectNew } from '../srs/queue';
import { makePack } from '../test/fixtures';
import { cardFace } from './faces';

describe('grammar cards', () => {
  const pack = makePack({ 5: 0, 4: 5 }, { 5: 0, 4: 0 }, { 4: 4, 3: 2 });
  const settings = { levels: [4, 3], newPerDay: 3, production: false, grammarPerDay: 2 };

  it('come from their own daily budget, easiest level first', () => {
    const picked = selectNew({ pack, settings, existing: new Set(), graduatedVocab: new Set(), introducedToday: { recognition: 0, production: 0 } });
    expect(picked.filter((r) => r.kind === 'vocab')).toHaveLength(3);
    expect(picked.filter((r) => r.kind === 'grammar').map((r) => r.itemId)).toEqual(['n4-g0', 'n4-g1']);
  });

  it('respect what was already introduced today and can be turned off', () => {
    const today = { recognition: 0, production: 0, grammar: 1 };
    const picked = selectNew({ pack, settings, existing: new Set(), graduatedVocab: new Set(), introducedToday: today });
    expect(picked.filter((r) => r.kind === 'grammar')).toHaveLength(1);
    const off = selectNew({ pack, settings: { ...settings, grammarPerDay: 0 }, existing: new Set(), graduatedVocab: new Set(), introducedToday: today });
    expect(off.some((r) => r.kind === 'grammar')).toBe(false);
  });

  it('rotate through example sentences and blank out the pattern', () => {
    const a = cardFace(pack, 'grammar', 'recognition', 'n4-g0', 0)!;
    const b = cardFace(pack, 'grammar', 'recognition', 'n4-g0', 1)!;
    const c = cardFace(pack, 'grammar', 'recognition', 'n4-g0', 2)!;
    expect(a.prompt).toBe('例0＿＿');
    expect(b.prompt).toBe('文0＿＿');
    expect(c.cloze?.example).toEqual(a.cloze?.example);
    expect(a.speak).toBe('例0たら');
  });
});

describe('splitAt', () => {
  it('splits plain text at the cloze and keeps words with furigana whole', () => {
    const segs = parseRuby('[雨|あめ]が[降|ふ]ったら、[行|い]かない。');
    // plain: 雨が降ったら、行かない。 — cloze on たら (4..6)
    const [before, inside, after] = splitAt(segs, [4, 6]);
    expect(before.map((s) => s.text).join('')).toBe('雨が降っ');
    expect(inside.map((s) => s.text).join('')).toBe('たら');
    expect(after.map((s) => s.text).join('')).toBe('、行かない。');
    expect(after.find((s) => s.text === '行')?.ruby).toBe('い');
  });
});
