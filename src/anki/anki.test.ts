import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { decompress } from 'fzstd';
import initSqlJs from 'sql.js';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { KanjiItem, Pack, VocabItem } from '../content/types';
import { FluentiaDB } from '../db/db';
import { buildSession } from '../db/repo';
import { DEFAULT_SETTINGS } from '../db/types';
import { State } from '../srs/scheduler';
import { makePack } from '../test/fixtures';
import { collectionBytes, parseCollection, type AnkiCollection } from './apkg';
import { ankiFurigana, cleanField, customFace, guessRoles, itemMatcher, planImport, scheduleFromAnki, type ImportOptions, type Roles } from './convert';
import { applyImport, deleteDeck } from './store';

/** The test pack with the real N5 words and kanji, so notes can match them. */
function realPack(): Pack {
  const vocab = (JSON.parse(readFileSync('public/packs/ja/vocab.json', 'utf8')) as VocabItem[]).filter((v) => v.level === 5);
  const kanji = (JSON.parse(readFileSync('public/packs/ja/kanji.json', 'utf8')) as KanjiItem[]).filter((k) => k.level === 5);
  return { ...makePack(), vocab, kanji, vocabById: new Map(vocab.map((v) => [v.id, v])), kanjiById: new Map(kanji.map((k) => [k.id, k])) };
}

const pack = realPack();
const cols: Record<'modern' | 'legacy', AnkiCollection> = {} as never;

beforeAll(async () => {
  const SQL = await initSqlJs();
  for (const name of ['modern', 'legacy'] as const) {
    const buf = readFileSync(`src/anki/fixtures/${name}.apkg`);
    const bytes = await collectionBytes(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, (b) => decompress(b));
    cols[name] = parseCollection(SQL, bytes);
  }
});

const rolesFor = (col: AnkiCollection) => {
  const roles = new Map<string, Roles>();
  for (const t of col.noteTypes.values()) {
    roles.set(t.id, guessRoles(t, col.notes.filter((n) => n.typeId === t.id).slice(0, 5).map((n) => n.fields)));
  }
  return roles;
};

const options = (col: AnkiCollection, over: Partial<ImportOptions> = {}): ImportOptions => ({
  lang: 'ja',
  deckIds: new Set(col.decks.keys()),
  roles: rolesFor(col),
  useBuiltIn: true,
  withProgress: true,
  now: Date.UTC(2026, 9, 11, 12),
  ...over,
});

describe('reading .apkg files', () => {
  it.each(['modern', 'legacy'] as const)('reads note types, decks, notes and cards (%s format)', (name) => {
    const col = cols[name];
    expect([...col.noteTypes.values()].map((t) => t.name)).toEqual(expect.arrayContaining(['Basic', 'Japanese (furigana)', 'Open Anki JLPT Vocab']));
    expect([...col.decks.values()]).toEqual(expect.arrayContaining(['Teacher::Class 1', 'Open Anki JLPT N5 Deck']));
    expect(col.notes.length).toBe(45 + 7);
    const astronaut = col.notes.find((n) => n.fields[0] === '宇宙飛行士');
    expect(astronaut?.fields).toEqual(['宇宙飛行士', 'astronaut', '宇宙[うちゅう] 飛行士[ひこうし]']);
    expect(col.cards.some((c) => c.type === 2 && c.ivl === 200)).toBe(true);
  });
});

describe('field text', () => {
  it('strips HTML, sounds and cloze markers', () => {
    expect(cleanField('<b>ありがとう</b>ございます')).toBe('ありがとうございます');
    expect(cleanField('Thank you<br>(polite)&nbsp;[sound:a.mp3]')).toBe('Thank you\n(polite)');
    expect(cleanField('{{c1::猫::animal}}が好き')).toBe('猫が好き');
  });

  it("turns Anki's furigana into ruby markup", () => {
    expect(ankiFurigana(' 日本語[にほんご]')).toEqual({ plain: '日本語', markup: '[日本語|にほんご]' });
    expect(ankiFurigana('宇宙[うちゅう] 飛行士[ひこうし]')).toEqual({ plain: '宇宙飛行士', markup: '[宇宙|うちゅう][飛行士|ひこうし]' });
    expect(ankiFurigana('食[た]べる')).toEqual({ plain: '食べる', markup: '[食|た]べる' });
    expect(ankiFurigana('ねこ')).toEqual({ plain: 'ねこ' });
  });

  it('guesses which fields are the word, its reading and the meaning', () => {
    const t = { id: '1', name: 'Vocab', fields: ['expression', 'reading', 'meaning', 'audio'] };
    expect(guessRoles(t, [['猫', 'ねこ', 'cat', '[sound:x]']])).toEqual({ front: 0, reading: 1, back: [2] });
    expect(guessRoles({ id: '2', name: 'Basic', fields: ['Front', 'Back'] }, [])).toEqual({ front: 0, reading: null, back: [1] });
  });
});

describe('matching notes to built-in items', () => {
  const match = itemMatcher(pack);
  it('finds words by spelling and reading, and single kanji', () => {
    expect(match('会う', 'あう')).toMatchObject({ kind: 'vocab', level: 5 });
    expect(match('ああ', 'ああ')).toMatchObject({ kind: 'vocab' });
    expect(match('今日', 'こんにち')).toBeNull();
    expect(match('日')).toMatchObject({ kind: 'kanji', itemId: '日' });
    expect(match('宇宙飛行士')).toBeNull();
  });
});

describe('scheduling', () => {
  it('keeps a review card due on the same day, with its interval as stability', () => {
    const crt = 1_791_702_000;
    const s = scheduleFromAnki({ noteId: '1', ord: 0, deckId: '1', type: 2, queue: 2, due: 3, ivl: 30, factor: 2500, reps: 5, lapses: 1 }, crt, Date.now());
    expect(s).toMatchObject({ state: State.Review, stability: 30, scheduledDays: 30, reps: 5, lapses: 1, due: (crt + 3 * 86400) * 1000 });
    expect(s!.difficulty).toBeGreaterThan(3);
    expect(s!.difficulty).toBeLessThan(6);
  });

  it('leaves new cards new', () => {
    expect(scheduleFromAnki({ noteId: '1', ord: 0, deckId: '1', type: 0, queue: 0, due: 1, ivl: 0, factor: 0, reps: 0, lapses: 0 }, 0, 0)).toBeNull();
  });
});

describe('planning an import', () => {
  it.each(['modern', 'legacy'] as const)('uses built-in cards where they exist and keeps the rest as a deck (%s)', (name) => {
    const plan = planImport(cols[name], pack, options(cols[name]));
    expect(plan.suspended).toBe(1);
    // Most N5 notes, and 会う and 自転車 in the teacher deck, are built-in words.
    expect(plan.matched).toBeGreaterThan(30);
    expect(plan.matchedStudied).toBeGreaterThan(10);
    const teacher = plan.decks.find((d) => d.name === 'Teacher::Class 1');
    expect(teacher).toBeTruthy();
    const notes = plan.notes.filter((n) => n.deckId === teacher!.id);
    expect(notes.map((n) => n.front)).toEqual(['猫が好きです。', '駅はどこですか。', 'ありがとうございます', '日本語', '宇宙飛行士']);
    expect(notes.find((n) => n.front === '宇宙飛行士')).toMatchObject({ reading: '[宇宙|うちゅう][飛行士|ひこうし]', back: 'astronaut' });
    expect(notes.find((n) => n.front === 'ありがとうございます')?.back).toBe('Thank you very much\n(polite)');
    // The teacher card reviewed in Anki keeps its progress.
    const ids = new Set(notes.map((n) => n.id));
    expect(plan.cards.filter((c) => c.kind === 'custom' && ids.has(c.itemId))).toHaveLength(1);
  });

  it('can start everything fresh and skip built-in matching', () => {
    const plan = planImport(cols.modern, pack, options(cols.modern, { withProgress: false, useBuiltIn: false }));
    expect(plan.matched).toBe(0);
    expect(plan.cards).toHaveLength(0);
    expect(plan.notes.length).toBe(45 - 1 + 7);
  });

  it('shows a kana reading field as ruby over the word', () => {
    const plan = planImport(cols.modern, pack, options(cols.modern, { useBuiltIn: false }));
    const kana = plan.notes.find((n) => n.front === 'ああ');
    expect(kana?.reading).toBeUndefined();
    const withKanji = plan.notes.find((n) => /\p{Script=Han}/u.test(n.front) && n.deckId.endsWith(String([...cols.modern.decks].find(([, v]) => v.includes('N5'))![0])));
    expect(withKanji?.reading).toMatch(/^\[.+\|.+\]$/);
  });
});

describe('saving an import', () => {
  let d: FluentiaDB;
  beforeEach(() => {
    d = new FluentiaDB(`test-${Math.random()}`);
  });
  afterEach(async () => {
    await d.delete();
  });

  it('adds the deck to study sessions and removes it again', async () => {
    const opts = options(cols.modern, { deckIds: new Set([...cols.modern.decks].filter(([, n]) => n === 'Teacher::Class 1').map(([id]) => id)) });
    const plan = planImport(cols.modern, pack, opts);
    await applyImport(plan, d);
    const settings = { ...DEFAULT_SETTINGS, levels: [5], newPerDay: 0, grammarPerDay: 0, production: false };
    const session = await buildSession(pack, settings, opts.now, d);
    const fresh = session.queue.filter((e) => e.type === 'new');
    const studiedInAnki = plan.cards.filter((c) => c.kind === 'custom').length;
    expect(fresh).toHaveLength(plan.notes.length - studiedInAnki);
    expect(studiedInAnki).toBe(1);
    expect(fresh.every((e) => e.type === 'new' && e.ref.kind === 'custom')).toBe(true);

    const note = await d.notes.get(plan.notes[0].id);
    expect(customFace(note!)).toMatchObject({ prompt: '猫が好きです。', promptIsTarget: true, answer: 'I like cats.' });

    await deleteDeck(plan.decks[0].id, opts.now, d);
    const after = await buildSession(pack, settings, opts.now + 400 * 86_400_000, d);
    expect(after.queue).toHaveLength(0);
  });

  it('never loses progress when the same deck is imported again', async () => {
    const plan = planImport(cols.modern, pack, options(cols.modern));
    await applyImport(plan, d);
    const studied = plan.cards[0];
    await d.cards.put({ ...studied, reps: studied.reps + 10 });
    const again = await applyImport(planImport(cols.modern, pack, options(cols.modern)), d);
    expect((await d.cards.get(studied.id))?.reps).toBe(studied.reps + 10);
    expect(again.cards).toBe(0);
  });
});
