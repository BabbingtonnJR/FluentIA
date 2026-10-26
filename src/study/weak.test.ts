import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FluentiaDB } from '../db/db';
import { exportBackup } from '../db/repo';
import { makePack } from '../test/fixtures';
import { cardId, newCard } from '../srs/scheduler';
import { mineCustom, mineVocab, minedDeckId } from './mine';
import { getContext, getMemo, groupMistakes, isLeech, leeches, openMistakes, recordMistake, resolveMistakes, saveMemo } from './weak';

let db: FluentiaDB;
const pack = makePack();
const lang = pack.manifest.id;

beforeEach(() => {
  db = new FluentiaDB(`test-${Math.random()}`);
});

afterEach(async () => {
  await db.delete();
});

describe('mistake notebook', () => {
  it('groups open mistakes by item, most missed first', async () => {
    const word = { kind: 'vocab' as const, id: pack.vocab[0].id };
    const point = { kind: 'grammar' as const, id: 'n4-tara' };
    await recordMistake(lang, word, 'quiz', 'あ', 1, db);
    await recordMistake(lang, point, 'mock', undefined, 2, db);
    await recordMistake(lang, word, 'practice', 'い', 3, db);
    const groups = await openMistakes(lang, db);
    expect(groups.map((g) => [g.kind, g.id, g.count])).toEqual([
      ['vocab', word.id, 2],
      ['grammar', 'n4-tara', 1],
    ]);
    expect(groups[0].sources).toEqual(['practice', 'quiz']);
    expect(groups[0].picked).toEqual(['い', 'あ']);
  });

  it('closes an item once it is answered right', async () => {
    const word = { kind: 'vocab' as const, id: pack.vocab[0].id };
    await recordMistake(lang, word, 'quiz', undefined, 1, db);
    await recordMistake(lang, { kind: 'kanji', id: word.id }, 'quiz', undefined, 1, db);
    expect(await resolveMistakes(lang, [word], 5, db)).toBe(1);
    const groups = await openMistakes(lang, db);
    expect(groups.map((g) => g.kind)).toEqual(['kanji']);
    expect(groupMistakes(await db.mistakes.toArray())).toHaveLength(1);
  });

  it('is part of the backup', async () => {
    await recordMistake(lang, { kind: 'vocab', id: 'x' }, 'wordle', undefined, 1, db);
    expect((await exportBackup(db)).mistakes).toHaveLength(1);
  });
});

describe('tricky cards', () => {
  it('flags cards forgotten again and again', () => {
    const card = newCard({ lang, kind: 'vocab', direction: 'recognition', itemId: 'a', level: 5 }, 0);
    expect(isLeech({ ...card, lapses: 3 })).toBe(false);
    expect(isLeech({ ...card, lapses: 4 })).toBe(true);
    expect(isLeech({ ...card, lapses: 9, deleted: true })).toBe(false);
    const list = leeches([
      { ...card, id: '1', lapses: 4 },
      { ...card, id: '2', lapses: 6 },
      { ...card, id: '3', lapses: 1 },
      { ...card, id: '4', kind: 'custom', lapses: 8 },
    ]);
    expect(list.map((c) => c.id)).toEqual(['2', '1']);
  });

  it('keeps a memory hook per item', async () => {
    const item = { kind: 'kanji' as const, id: '語' };
    expect(await getMemo(lang, item, db)).toBe('');
    await saveMemo(lang, item, '  words 言 + five 五 + mouth 口  ', db);
    expect(await getMemo(lang, item, db)).toBe('words 言 + five 五 + mouth 口');
  });
});

describe('sentence mining', () => {
  const sentence = { r: '[語|ご]を[読|よ]む', e: 'Read the word', source: 'A story' };

  it('starts a word from the list with its sentence', async () => {
    const v = pack.vocab[3];
    expect(await mineVocab(pack, v.id, sentence, 10, db)).toBe(true);
    const card = await db.cards.get(cardId(lang, 'vocab', 'recognition', v.id));
    expect(card?.due).toBe(10);
    expect(await getContext(lang, { kind: 'vocab', id: v.id }, db)).toEqual({ ...sentence, at: 10 });
    // Mined again: the card stays, the sentence is the newest one.
    expect(await mineVocab(pack, v.id, { r: '別' }, 20, db)).toBe(false);
    expect((await getContext(lang, { kind: 'vocab', id: v.id }, db))?.r).toBe('別');
  });

  it('puts other words in a Mined words deck', async () => {
    const note = await mineCustom(lang, { text: '狐', reading: 'きつね', meaning: 'fox' }, sentence, 10, db);
    const second = await mineCustom(lang, { text: '狸', meaning: 'raccoon dog' }, { r: 'x' }, 11, db);
    expect((await db.decks.get(minedDeckId(lang)))?.name).toBe('Mined words');
    expect(note.reading).toBe('[狐|きつね]');
    expect(note.back).toBe('fox\n\n語を読む\nRead the word\n— A story');
    expect(second.order).toBe(1);
    expect(second.back).toBe('raccoon dog\n\nx');
    expect(await db.cards.get(cardId(lang, 'custom', 'recognition', note.id))).toBeTruthy();
  });
});
