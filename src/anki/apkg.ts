import type { Database, SqlJsStatic } from 'sql.js';
import { readZip } from '../manga/zip';

/** A card template: which card number it makes and what its question shows. */
export interface AnkiTemplate {
  ord: number;
  name: string;
  /** The question side's template, e.g. "{{Front}}" or "{{Back}}" for a reversed card. */
  question: string;
}

/** A note type: its name, field names in field order, and card templates. */
export interface AnkiNoteType {
  id: string;
  name: string;
  fields: string[];
  templates: AnkiTemplate[];
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

// --- Protocol buffers (Anki 2.1.50+ stores some data this way) -------------------------

/** The fields of a protocol buffer message, in order: varints as numbers, the rest as bytes. */
export function protoFields(buf: Uint8Array): { field: number; value: number | Uint8Array }[] {
  const out: { field: number; value: number | Uint8Array }[] = [];
  let p = 0;
  const varint = () => {
    let n = 0;
    let shift = 1;
    for (;;) {
      const b = buf[p++];
      n += (b & 0x7f) * shift;
      if (b < 0x80) return n;
      shift *= 128;
    }
  };
  while (p < buf.length) {
    const tag = varint();
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) out.push({ field, value: varint() });
    else if (wire === 2) {
      const len = varint();
      out.push({ field, value: buf.subarray(p, p + len) });
      p += len;
    } else if (wire === 1) p += 8;
    else if (wire === 5) p += 4;
    else break;
  }
  return out;
}

const utf8 = new TextDecoder();

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
      // Name columns use Anki's own "unicase" collation, which sql.js lacks: never filter or sort on them in SQL.
      for (const r of rows(db, 'select id, name from decks')) decks.set(str(r.id), str(r.name).replace(/\x1f/g, '::'));
      for (const r of rows(db, 'select id, name from notetypes')) noteTypes.set(str(r.id), { id: str(r.id), name: str(r.name), fields: [], templates: [] });
      for (const r of rows(db, 'select ntid, ord, name from fields order by ntid, ord')) noteTypes.get(str(r.ntid))?.fields.push(str(r.name));
      for (const r of rows(db, 'select ntid, ord, name, config from templates order by ntid, ord')) {
        // The template's config message: field 1 is the question format.
        const q = r.config instanceof Uint8Array ? protoFields(r.config).find((f) => f.field === 1)?.value : undefined;
        noteTypes.get(str(r.ntid))?.templates.push({ ord: Number(r.ord), name: str(r.name), question: q instanceof Uint8Array ? utf8.decode(q) : '' });
      }
    } else {
      type Model = { id: number; name: string; flds: { name: string; ord: number }[]; tmpls?: { name: string; ord: number; qfmt: string }[] };
      const models = JSON.parse(str(col.models) || '{}') as Record<string, Model>;
      for (const m of Object.values(models)) {
        noteTypes.set(String(m.id), {
          id: String(m.id),
          name: m.name,
          fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
          templates: (m.tmpls ?? []).map((t) => ({ ord: t.ord, name: t.name, question: t.qfmt })),
        });
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

/** Media files in a package by their name in the notes (neko.mp3), each read only when needed. */
export type MediaFiles = Map<string, () => Promise<Uint8Array<ArrayBuffer>>>;

export interface AnkiPackage {
  collection: Uint8Array;
  media: MediaFiles;
}

const isZstd = (b: Uint8Array) => b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;

/**
 * The collection and media inside an .apkg (a zip). Anki 2.1.50+ stores the collection
 * zstd-compressed as collection.anki21b (leaving a placeholder in collection.anki2), lists the
 * media in a zstd-compressed protocol buffer and compresses each file; older exports have
 * collection.anki21 or collection.anki2 and a JSON media list. Media files are named 0, 1, 2…
 */
export async function openPackage(apkg: ArrayBuffer, unzstd: (b: Uint8Array) => Uint8Array): Promise<AnkiPackage> {
  const entries = new Map(readZip(apkg).map((e) => [e.name, e]));
  const unpack = (b: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => (isZstd(b) ? (unzstd(b) as Uint8Array<ArrayBuffer>) : b);

  const modern = entries.get('collection.anki21b');
  const legacy = entries.get('collection.anki21') ?? entries.get('collection.anki2');
  if (!modern && !legacy) throw new Error('No Anki collection in this file. Export the deck from Anki as "Anki Deck Package (.apkg)".');
  const collection = modern ? unzstd(await modern.read()) : await legacy!.read();

  const media: MediaFiles = new Map();
  const list = entries.get('media');
  if (list) {
    const raw = unpack(await list.read());
    const names: [string, string][] = [];
    if (raw[0] === 0x7b /* { */) {
      for (const [zipName, name] of Object.entries(JSON.parse(utf8.decode(raw)) as Record<string, string>)) names.push([zipName, name]);
    } else {
      // MediaEntries { repeated MediaEntry entries = 1 }, MediaEntry { name = 1; size = 2; sha1 = 3; legacy_zip_filename = 255 }
      protoFields(raw)
        .filter((f) => f.field === 1 && f.value instanceof Uint8Array)
        .forEach((f, i) => {
          const fields = protoFields(f.value as Uint8Array);
          const name = fields.find((x) => x.field === 1)?.value;
          const legacyName = fields.find((x) => x.field === 255)?.value;
          if (name instanceof Uint8Array) names.push([String(typeof legacyName === 'number' ? legacyName : i), utf8.decode(name)]);
        });
    }
    for (const [zipName, name] of names) {
      const entry = entries.get(zipName);
      if (entry) media.set(name, async () => unpack(await entry.read()));
    }
  }
  return { collection, media };
}

/** Opens an .apkg in the browser; sql.js (SQLite in WebAssembly) and the zstd decoder load only here. */
export async function readApkg(apkg: ArrayBuffer): Promise<AnkiCollection & { media: MediaFiles }> {
  const [{ default: initSqlJs }, { default: wasmUrl }, { decompress }] = await Promise.all([
    import('sql.js'),
    import('sql.js/dist/sql-wasm.wasm?url'),
    import('fzstd'),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const pkg = await openPackage(apkg, (b) => decompress(b));
  return { ...parseCollection(SQL, pkg.collection), media: pkg.media };
}
