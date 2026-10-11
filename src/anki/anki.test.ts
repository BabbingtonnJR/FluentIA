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
import { openPackage, parseCollection, type AnkiCollection, type MediaFiles } from './apkg';
import {
  ankiFurigana,
  cleanField,
  customFace,
  fieldMedia,
  guessRoles,
  itemMatcher,
  planImport,
  scheduleFromAnki,
  templateDirections,
  type ImportOptions,
  type Roles,
} from './convert';
import { applyImport, deleteDeck } from './store';

/** The test pack with the real N5 words and kanji, so notes can match them. */
function realPack(): Pack {
  const vocab = (JSON.parse(readFileSync('public/packs/ja/vocab.json', 'utf8')) as VocabItem[]).filter((v) => v.level === 5);
  const kanji = (JSON.parse(readFileSync('public/packs/ja/kanji.json', 'utf8')) as KanjiItem[]).filter((k) => k.level === 5);
  return { ...makePack(), vocab, kanji, vocabById: new Map(vocab.map((v) => [v.id, v])), kanjiById: new Map(kanji.map((k) => [k.id, k])) };
}

const pack = realPack();
type Loaded = AnkiCollection & { media: MediaFiles };
const cols: Record<'modern' | 'legacy', Loaded> = {} as never;

// The fixtures (made with Anki itself, see CREDITS.md) hold 45 notes of the N5 deck, some studied
// and one suspended, and a "Teacher::Class 1" deck: Basic notes (one with a picture and a sound,
// one listening card with only a sound on the front), notes with Anki furigana, and a note with
// a reversed card, both cards studied.
beforeAll(async () => {
  const SQL = await initSqlJs();
  for (const name of ['modern', 'legacy'] as const) {
    const buf = readFileSync(`src/anki/fixtures/${name}.apkg`);
    const pkg = await openPackage(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, (b) => decompress(b));
    cols[name] = { ...parseCollection(SQL, pkg.collection), media: pkg.media };
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

const teacherDeck = (col: AnkiCollection) => [...col.decks].find(([, n]) => n === 'Teacher::Class 1')![0];

describe('reading .apkg files', () => {
  it.each(['modern', 'legacy'] as const)('reads note types, templates, decks, notes and cards (%s format)', (name) => {
    const col = cols[name];
    expect([...col.noteTypes.values()].map((t) => t.name)).toEqual(expect.arrayContaining(['Basic', 'Japanese (furigana)', 'Open Anki JLPT Vocab']));
    expect([...col.decks.values()]).toEqual(expect.arrayContaining(['Teacher::Class 1', 'Open Anki JLPT N5 Deck']));
    expect(col.notes.length).toBe(45 + 9);
    const astronaut = col.notes.find((n) => n.fields[0] === '宇宙飛行士');
    expect(astronaut?.fields).toEqual(['宇宙飛行士', 'astronaut', '宇宙[うちゅう] 飛行士[ひこうし]']);
    expect(col.cards.some((c) => c.type === 2 && c.ivl === 200)).toBe(true);
    const reversed = [...col.noteTypes.values()].find((t) => t.name === 'Basic (and reversed card)')!;
    expect(reversed.templates.map((t) => t.question)).toEqual(['{{Front}}', '{{Back}}']);
  });

  it.each(['modern', 'legacy'] as const)('finds the pictures and sounds (%s format)', async (name) => {
    const media = cols[name].media;
    expect([...media.keys()].sort()).toEqual(['neko.png', 'neko.wav', 'ohayou.wav']);
    const png = await media.get('neko.png')!();
    expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
    const wav = await media.get('ohayou.wav')!();
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF');
  });
});

describe('field text', () => {
  it('strips HTML, sounds and cloze markers', () => {
    expect(cleanField('<b>ありがとう</b>ございます')).toBe('ありがとうございます');
    expect(cleanField('Thank you<br>(polite)&nbsp;[sound:a.mp3]')).toBe('Thank you\n(polite)');
    expect(cleanField('{{c1::猫::animal}}が好き')).toBe('猫が好き');
  });

  it('lists the pictures and sounds in a field', () => {
    expect(fieldMedia('猫<br><img src="neko.png"> [sound:neko.mp3]<img class=x src=a&amp;b.jpg>')).toEqual(['neko.png', 'a&b.jpg', 'neko.mp3']);
  });

  it("turns Anki's furigana into ruby markup", () => {
    expect(ankiFurigana(' 日本語[にほんご]')).toEqual({ plain: '日本語', markup: '[日本語|にほんご]' });
    expect(ankiFurigana('宇宙[うちゅう] 飛行士[ひこうし]')).toEqual({ plain: '宇宙飛行士', markup: '[宇宙|うちゅう][飛行士|ひこうし]' });
    expect(ankiFurigana('食[た]べる')).toEqual({ plain: '食べる', markup: '[食|た]べる' });
    expect(ankiFurigana('ねこ')).toEqual({ plain: 'ねこ' });
  });

  it('guesses which fields are the word, its reading and the meaning', () => {
    const t = { id: '1', name: 'Vocab', fields: ['expression', 'reading', 'meaning', 'audio'], templates: [] };
    expect(guessRoles(t, [['猫', 'ねこ', 'cat', '[sound:x]']])).toEqual({ front: 0, reading: 1, back: [2] });
    expect(guessRoles({ id: '2', name: 'Basic', fields: ['Front', 'Back'], templates: [] }, [])).toEqual({ front: 0, reading: null, back: [1] });
  });

  it('tells front → back templates from reversed ones', () => {
    const type = {
      id: '1',
      name: 'Vocab',
      fields: ['Word', 'Reading', 'Meaning'],
      templates: [
        { ord: 0, name: 'Recognition', question: '{{furigana:Word}}' },
        { ord: 1, name: 'Production', question: '<div>{{Meaning}}</div>' },
        { ord: 2, name: 'Listening', question: '{{#Reading}}{{Audio}}{{/Reading}}' },
      ],
    };
    expect([...templateDirections(type, { front: 0, reading: 1, back: [2] })]).toEqual([
      [0, 'recognition'],
      [1, 'production'],
    ]);
  });
});

describe('matching notes to built-in items', () => {
  const match = itemMatcher(pack);
  it('finds words by spelling and reading, and single kanji', () => {
    expect(match('会う', 'あう')).toMatchObject({ kind: 'vocab', level: 5 });
    expect(match('ああ', 'ああ')).toMatchObject({ kind: 'vocab' });
    expect(match('足; 脚', 'あし')).toMatchObject({ kind: 'vocab' });
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
    const col = cols[name];
    const plan = planImport(col, pack, options(col));
    expect(plan.suspended).toBe(1);
    // Nearly all N5 notes, and 会う and 自転車 in the teacher deck, are built-in words.
    expect(plan.matched).toBeGreaterThan(40);
    expect(plan.matchedStudied).toBeGreaterThan(10);
    // Studied reversed cards of built-in words become "Say it in Japanese" cards.
    expect(plan.cards.some((c) => c.kind === 'vocab' && c.direction === 'production')).toBe(true);

    const notes = plan.notes.filter((n) => n.deckId === `anki:${teacherDeck(col)}`);
    expect(notes.map((n) => n.front)).toEqual(['猫が好きです。', '駅はどこですか。', 'ありがとうございます', '日本語', '宇宙飛行士', '', '犬小屋']);
    expect(notes.find((n) => n.front === '宇宙飛行士')).toMatchObject({ reading: '[宇宙|うちゅう][飛行士|ひこうし]', back: 'astronaut' });
    expect(notes.find((n) => n.front === 'ありがとうございます')?.back).toBe('Thank you very much\n(polite)');
    expect(notes[0].media).toEqual({ front: ['neko.png'], back: ['neko.wav'] });
    expect(notes[5]).toMatchObject({ back: 'おはよう (good morning)', media: { front: ['ohayou.wav'], back: [] } });
    expect(plan.media.sort()).toEqual(['neko.png', 'neko.wav', 'ohayou.wav']);

    // The reversed note: asked both ways, and both of its studied cards keep their progress.
    const dog = notes.find((n) => n.front === '犬小屋')!;
    expect(dog.reverse).toBe(true);
    expect(plan.reverse).toBe(1);
    const ids = new Set(notes.map((n) => n.id));
    const custom = plan.cards.filter((c) => c.kind === 'custom' && ids.has(c.itemId));
    expect(custom.map((c) => `${c.itemId === dog.id ? 'dog' : 'cat'} ${c.direction}`).sort()).toEqual([
      'cat recognition',
      'dog production',
      'dog recognition',
    ]);
  });

  it('can start everything fresh and skip built-in matching', () => {
    const plan = planImport(cols.modern, pack, options(cols.modern, { withProgress: false, useBuiltIn: false }));
    expect(plan.matched).toBe(0);
    expect(plan.cards).toHaveLength(0);
    expect(plan.notes.length).toBe(45 - 1 + 9);
  });

  it('shows a kana reading field as ruby over the word', () => {
    const plan = planImport(cols.modern, pack, options(cols.modern, { useBuiltIn: false }));
    expect(plan.notes.find((n) => n.front === 'ああ')?.reading).toBeUndefined();
    expect(plan.notes.find((n) => n.front === '会う')?.reading).toBe('[会う|あう]');
  });
});

describe('studying a card from a deck', () => {
  const note = (over: object) => ({ id: 'n', lang: 'ja', deckId: 'd', front: '犬小屋', back: 'doghouse', order: 0, createdAt: 0, updatedAt: 0, ...over });

  it('asks a reversed card back → front, without giving the answer away in sound', () => {
    const face = customFace(note({ reading: '[犬小屋|いぬごや]', media: { front: ['inu.mp3'], back: ['dog.png'] } }), 'production');
    expect(face).toMatchObject({ prompt: 'doghouse', promptIsTarget: false, answer: '犬小屋', reading: 'いぬごや' });
    expect(face.question).toEqual({ images: ['dog.png'], sounds: [] });
    expect(face.answerMedia.sounds).toEqual(['inu.mp3']);
  });

  it('plays the front sound as the question of a listening card', () => {
    const face = customFace(note({ front: '', back: 'おはよう', media: { front: ['ohayou.mp3'], back: [] } }));
    expect(face.question.sounds).toEqual(['ohayou.mp3']);
    expect(face.promptIsTarget).toBe(true);
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

  it('adds the deck with its media to study sessions and removes it again', async () => {
    const col = cols.modern;
    const opts = options(col, { deckIds: new Set([teacherDeck(col)]) });
    const plan = planImport(col, pack, opts);
    const saved = await applyImport(plan, col.media, d);
    expect(saved.media).toBe(3);
    expect((await d.media.get('neko.png'))?.blob.type).toBe('image/png');

    const settings = { ...DEFAULT_SETTINGS, levels: [5], newPerDay: 0, grammarPerDay: 0, production: false };
    const session = await buildSession(pack, settings, opts.now, d);
    const fresh = session.queue.filter((e) => e.type === 'new');
    const studiedInAnki = plan.cards.filter((c) => c.kind === 'custom' && c.direction === 'recognition').length;
    expect(fresh).toHaveLength(plan.notes.length - studiedInAnki);
    expect(fresh.every((e) => e.type === 'new' && e.ref.kind === 'custom' && e.ref.direction === 'recognition')).toBe(true);

    const first = await d.notes.get(plan.notes[0].id);
    expect(customFace(first!)).toMatchObject({ prompt: '猫が好きです。', promptIsTarget: true, answer: 'I like cats.' });

    await deleteDeck(plan.decks[0].id, opts.now, d);
    const after = await buildSession(pack, settings, opts.now + 400 * 86_400_000, d);
    expect(after.queue).toHaveLength(0);
    expect(await d.media.count()).toBe(0);
  });

  it('introduces a reversed card once its front → back card is learnt', async () => {
    const col = cols.modern;
    const opts = options(col, { deckIds: new Set([teacherDeck(col)]), withProgress: false });
    const plan = planImport(col, pack, opts);
    await applyImport(plan, new Map(), d);
    const dog = plan.notes.find((n) => n.reverse)!;
    const settings = { ...DEFAULT_SETTINGS, levels: [5], newPerDay: 0, grammarPerDay: 0, production: false };
    const directions = async () =>
      (await buildSession(pack, settings, opts.now, d)).queue.flatMap((e) => (e.type === 'new' && e.ref.itemId === dog.id ? [e.ref.direction] : []));
    expect(await directions()).toEqual(['recognition']);
    await d.cards.put({ ...(await import('../srs/scheduler')).knownCard({ lang: 'ja', kind: 'custom', direction: 'recognition', itemId: dog.id, level: 0 }, opts.now) });
    expect(await directions()).toEqual(['production']);
  });

  it('never loses progress when the same deck is imported again', async () => {
    const plan = planImport(cols.modern, pack, options(cols.modern));
    await applyImport(plan, new Map(), d);
    const studied = plan.cards[0];
    await d.cards.put({ ...studied, reps: studied.reps + 10 });
    const again = await applyImport(planImport(cols.modern, pack, options(cols.modern)), new Map(), d);
    expect((await d.cards.get(studied.id))?.reps).toBe(studied.reps + 10);
    expect(again.cards).toBe(0);
  });
});
