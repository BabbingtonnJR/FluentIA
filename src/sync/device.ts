import { db, SYNCED_TABLES, type FluentiaDB } from '../db/db';

/** Every table holding one person's study data; all of it belongs to the signed-in account. */
const LOCAL_TABLES = [...SYNCED_TABLES, 'meta', 'videos', 'manga', 'mangaPages'] as const;
const OWNER_KEY = 'owner';

export async function getMeta<T>(key: string, d: FluentiaDB = db): Promise<T | null> {
  return ((await d.meta.get(key))?.value as T) ?? null;
}

export async function setMeta(key: string, value: unknown, d: FluentiaDB = db) {
  await d.meta.put({ key, value });
}

/** Removes everything this device holds for the last account, so the next one starts clean. */
export async function wipeLocal(d: FluentiaDB = db) {
  await d.transaction('rw', [...LOCAL_TABLES], async () => {
    for (const t of LOCAL_TABLES) await d.table(t).clear();
  });
  try {
    // Reading positions and games in progress; the auth session (sb-*) is managed by Supabase.
    for (const key of Object.keys(localStorage)) if (!key.startsWith('sb-')) localStorage.removeItem(key);
  } catch {
    /* storage missing or blocked: nothing was saved there either */
  }
}

/**
 * Makes sure local data belongs to this account before syncing. Data from no account (used before
 * signing in) is kept and uploaded; data from another account is removed first.
 */
export async function claimDevice(userId: string, d: FluentiaDB = db) {
  const owner = await getMeta<string>(OWNER_KEY, d);
  if (owner === userId) return;
  if (owner) await wipeLocal(d);
  await setMeta(OWNER_KEY, userId, d);
}

/** Changes made on this device that the server has not received yet. */
export async function unsyncedCount(d: FluentiaDB = db): Promise<number> {
  let n = 0;
  for (const t of SYNCED_TABLES) {
    const cursor = (await getMeta<number>(`push:${t}`, d)) ?? 0;
    n += await d.table(t).where('updatedAt').above(cursor).count();
  }
  return n;
}
