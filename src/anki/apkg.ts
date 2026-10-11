import type { Database, SqlJsStatic } from 'sql.js';
import { readZip } from '../manga/zip';

/** A note type: its name and field names, in field order. */
export interface AnkiNoteType {
  id: string;
  name: string;
  fields: string[];
}

export interface AnkiNote {
  id: string;
  /** Stable across exports and collections: used to recognise a note when a deck is imported again. */
  guid: string;
  typeId: string;
  /** Raw field contents (HTML), in the note type's field order. */
  fields: string[];
  tags: string[];
}

/** Scheduling of one card, as Anki stores it. */
export interface AnkiCard {
  noteId: string;
  /** Template number: 0 is the first (usually front → back). */
  ord: number;
  deckId: string;
  /** 0 new, 1 learning, 2 review, 3 relearning. */
  type: number;
  /** -1 suspended, -2 / -3 buried, otherwise like type. */
  queue: number;
  /** Review cards: days since the collection was created; learning cards: epoch seconds; new: position. */
  due: number;
  /** Interval in days (negative: seconds, for learning cards). */
  ivl: number;
  /** Ease in permille (2500 = 250%). */
  factor: number;
  reps: number;
  lapses: number;
}

export interface AnkiCollection {
  /** Collection creation, epoch seconds, at the day rollover: review due dates count days from here. */
  crt: number;
  decks: Map<string, string>;
  noteTypes: Map<string, AnkiNoteType>;
  notes: AnkiNote[];
  cards: AnkiCard[];
}

/** Rows of a query as objects. */
function rows(db: Database, sql: string): Record<string, unknown>[] {
  const res = db.exec(sql)[0];
  if (!res) return [];
  return res.values.map((v) => Object.fromEntries(res.columns.map((c, i) => [c, v[i]])));
}

const str = (v: unknown) => String(v ?? '');

/** Reads an Anki collection (SQLite), in the legacy (schema 11) or current (schema 18) layout. */
export function parseCollection(SQL: SqlJsStatic, bytes: Uint8Array): AnkiCollection {
  const db = new SQL.Database(bytes);
  try {
    const tables = new Set(rows(db, "select name from sqlite_master where type = 'table'").map((r) => str(r.name)));
    const col = rows(db, 'select crt, models, decks from col')[0];
    if (!col || !tables.has('notes') || !tables.has('cards')) throw new Error('This is not an Anki collection.');

    const decks = new Map<string, string>();
    const noteTypes = new Map<string, AnkiNoteType>();
    if (tables.has('notetypes')) {
      for (const r of rows(db, 'select id, name from decks')) decks.set(str(r.id), str(r.name).replace(/\x1f/g, '::'));
      for (const r of rows(db, 'select id, name from notetypes')) noteTypes.set(str(r.id), { id: str(r.id), name: str(r.name), fields: [] });
      for (const r of rows(db, 'select ntid, ord, name from fields order by ntid, ord')) noteTypes.get(str(r.ntid))?.fields.push(str(r.name));
    } else {
      const models = JSON.parse(str(col.models) || '{}') as Record<string, { id: number; name: string; flds: { name: string; ord: number }[] }>;
      for (const m of Object.values(models)) {
        noteTypes.set(String(m.id), { id: String(m.id), name: m.name, fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name) });
      }
      const deckJson = JSON.parse(str(col.decks) || '{}') as Record<string, { id: number; name: string }>;
      for (const d of Object.values(deckJson)) decks.set(String(d.id), d.name);
    }

    const notes = rows(db, 'select id, guid, mid, flds, tags from notes order by id').map(
      (r): AnkiNote => ({
        id: str(r.id),
        guid: str(r.guid),
        typeId: str(r.mid),
        fields: str(r.flds).split('\x1f'),
        tags: str(r.tags).trim().split(/\s+/).filter(Boolean),
      }),
    );
    const cards = rows(db, 'select nid, ord, did, type, queue, due, ivl, factor, reps, lapses from cards').map(
      (r): AnkiCard => ({
        noteId: str(r.nid),
        ord: Number(r.ord),
        deckId: str(r.did),
        type: Number(r.type),
        queue: Number(r.queue),
        due: Number(r.due),
        ivl: Number(r.ivl),
        factor: Number(r.factor),
        reps: Number(r.reps),
        lapses: Number(r.lapses),
      }),
    );
    return { crt: Number(col.crt), decks, noteTypes, notes, cards };
  } finally {
    db.close();
  }
}

/**
 * The collection inside an .apkg (a zip). Anki 2.1.50+ stores it zstd-compressed as
 * collection.anki21b and leaves a placeholder in collection.anki2; older exports have
 * collection.anki21 or collection.anki2.
 */
export async function collectionBytes(apkg: ArrayBuffer, unzstd: (b: Uint8Array) => Uint8Array): Promise<Uint8Array> {
  const entries = readZip(apkg);
  const find = (name: string) => entries.find((e) => e.name === name);
  const modern = find('collection.anki21b');
  if (modern) return unzstd(await modern.read());
  const legacy = find('collection.anki21') ?? find('collection.anki2');
  if (!legacy) throw new Error('No Anki collection in this file. Export the deck from Anki as "Anki Deck Package (.apkg)".');
  return legacy.read();
}

/** Opens an .apkg in the browser; sql.js (SQLite in WebAssembly) and the zstd decoder load only here. */
export async function readApkg(apkg: ArrayBuffer): Promise<AnkiCollection> {
  const [{ default: initSqlJs }, { default: wasmUrl }, { decompress }] = await Promise.all([
    import('sql.js'),
    import('sql.js/dist/sql-wasm.wasm?url'),
    import('fzstd'),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  return parseCollection(SQL, await collectionBytes(apkg, (b) => decompress(b)));
}
