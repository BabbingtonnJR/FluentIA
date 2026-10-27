// Weak spots: wrong answers kept in a notebook, cards that keep being forgotten (leeches), the
// learner's own memory hooks for them, and the sentence a mined word was met in.
import { db, type FluentiaDB } from '../db/db';
import type { CardRecord, MistakeRecord, MistakeSource } from '../db/types';
import type { ItemKind } from '../content/types';
import { uid } from '../lib/time';
import { notifyLocalChange } from '../sync/events';

export interface ItemRef {
  kind: ItemKind;
  id: string;
}

/** A card forgotten this many times is a leech: it needs a different approach, not more reviews. */
export const LEECH_LAPSES = 4;

export function isLeech(card: Pick<CardRecord, 'lapses' | 'deleted'>): boolean {
  return !card.deleted && card.lapses >= LEECH_LAPSES;
}

/** Leeches first by how often they were forgotten, built-in items only. */
export function leeches(cards: CardRecord[]): CardRecord[] {
  return cards.filter((c) => c.kind !== 'custom' && isLeech(c)).sort((a, b) => b.lapses - a.lapses || b.updatedAt - a.updatedAt);
}

export async function recordMistake(
  lang: string,
  item: ItemRef,
  source: MistakeSource,
  picked?: string,
  now = Date.now(),
  d: FluentiaDB = db,
): Promise<void> {
  const rec: MistakeRecord = { id: uid(), lang, kind: item.kind, itemId: item.id, source, at: now, updatedAt: now, ...(picked ? { picked } : {}) };
  await d.mistakes.put(rec);
  notifyLocalChange();
}

/** Closes the open mistakes on these items: they were just answered right. */
export async function resolveMistakes(lang: string, items: ItemRef[], now = Date.now(), d: FluentiaDB = db): Promise<number> {
  let n = 0;
  await d.transaction('rw', d.mistakes, async () => {
    for (const item of items) {
      const open = (await d.mistakes.where('[lang+itemId]').equals([lang, item.id]).toArray()).filter((m) => m.kind === item.kind && !m.resolvedAt);
      for (const m of open) await d.mistakes.put({ ...m, resolvedAt: now, updatedAt: now });
      n += open.length;
    }
  });
  if (n) notifyLocalChange();
  return n;
}

export interface MistakeGroup extends ItemRef {
  count: number;
  last: number;
  sources: MistakeSource[];
  /** Wrong options picked, most recent first. */
  picked: string[];
}

/** Open mistakes, one entry per item, the most-missed first. */
export function groupMistakes(records: MistakeRecord[]): MistakeGroup[] {
  const groups = new Map<string, MistakeGroup>();
  for (const m of [...records].sort((a, b) => b.at - a.at)) {
    if (m.resolvedAt) continue;
    const key = `${m.kind}:${m.itemId}`;
    const g = groups.get(key) ?? { kind: m.kind, id: m.itemId, count: 0, last: m.at, sources: [], picked: [] };
    g.count++;
    if (!g.sources.includes(m.source)) g.sources.push(m.source);
    if (m.picked && !g.picked.includes(m.picked)) g.picked.push(m.picked);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.last - a.last);
}

export async function openMistakes(lang: string, d: FluentiaDB = db): Promise<MistakeGroup[]> {
  return groupMistakes(await d.mistakes.where('[lang+at]').between([lang, -Infinity], [lang, Infinity]).toArray());
}

// --- Per-item notes, kept in the synced key-value table ----------------------------------

const memoKey = (lang: string, item: ItemRef) => `memo:${lang}:${item.kind}:${item.id}`;
const contextKey = (lang: string, item: ItemRef) => `context:${lang}:${item.kind}:${item.id}`;

/** The learner's own memory hook for an item (a mnemonic, a contrast, a story). */
export async function getMemo(lang: string, item: ItemRef, d: FluentiaDB = db): Promise<string> {
  return ((await d.kv.get(memoKey(lang, item)))?.value as string | undefined) ?? '';
}

export async function saveMemo(lang: string, item: ItemRef, text: string, d: FluentiaDB = db): Promise<void> {
  await d.kv.put({ id: memoKey(lang, item), value: text.trim(), updatedAt: Date.now() });
  notifyLocalChange();
}

/** Every memo of a language, by "kind:id". */
export async function allMemos(lang: string, d: FluentiaDB = db): Promise<Map<string, string>> {
  const prefix = `memo:${lang}:`;
  const recs = await d.kv.where('id').startsWith(prefix).toArray();
  return new Map(recs.filter((r) => r.value).map((r) => [r.id.slice(prefix.length), r.value as string]));
}

/** The sentence a word was mined from: furigana markup, its translation if known, and where it came from. */
export interface MinedContext {
  r: string;
  e?: string;
  source?: string;
  at: number;
}

export async function getContext(lang: string, item: ItemRef, d: FluentiaDB = db): Promise<MinedContext | null> {
  return ((await d.kv.get(contextKey(lang, item)))?.value as MinedContext | undefined) ?? null;
}

export async function saveContext(lang: string, item: ItemRef, ctx: MinedContext, d: FluentiaDB = db): Promise<void> {
  await d.kv.put({ id: contextKey(lang, item), value: ctx, updatedAt: Date.now() });
  notifyLocalChange();
}
