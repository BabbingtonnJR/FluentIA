import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { db, SYNCED_TABLES, type SyncedTable } from '../db/db';
import type { Synced } from '../db/types';
import { onLocalChange } from './events';
import { pullFrom, recordsToApply } from './merge';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

export type SyncPhase = 'unconfigured' | 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  email: string | null;
  lastSyncedAt: number | null;
  error: string | null;
}

let status: SyncStatus = {
  phase: supabase ? 'signed-out' : 'unconfigured',
  email: null,
  lastSyncedAt: null,
  error: null,
};
const listeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  for (const l of listeners) l();
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => status,
  );
}

const PAGE = 500;

async function getMeta<T>(key: string): Promise<T | null> {
  return ((await db.meta.get(key))?.value as T) ?? null;
}

async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}

async function push(client: SupabaseClient, table: SyncedTable) {
  const cursorKey = `push:${table}`;
  const cursor = (await getMeta<number>(cursorKey)) ?? 0;
  const pending = (await db.table(table).where('updatedAt').above(cursor).sortBy('updatedAt')) as Synced[];
  for (let i = 0; i < pending.length; i += PAGE) {
    const batch = pending.slice(i, i + PAGE);
    const { error } = await client.from('records').upsert(
      batch.map((r) => ({ collection: table, id: r.id, data: r, updated_at: r.updatedAt })),
      { onConflict: 'user_id,collection,id' },
    );
    if (error) throw new Error(error.message);
    await setMeta(cursorKey, batch[batch.length - 1].updatedAt);
  }
  return pending.length;
}

async function pull(client: SupabaseClient) {
  const cursorKey = 'pull';
  let cursor = await getMeta<string>(cursorKey);
  // Only the first page overlaps the previous sync; later pages continue exactly where the last one ended.
  let from = pullFrom(cursor);
  let applied = 0;
  for (;;) {
    const { data, error } = await client
      .from('records')
      .select('collection, id, data, server_updated_at')
      .gt('server_updated_at', from)
      .order('server_updated_at', { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(error.message);
    if (!data.length) break;

    for (const table of SYNCED_TABLES) {
      const remote = data.filter((r) => r.collection === table).map((r) => r.data as Synced);
      if (!remote.length) continue;
      const local = (await db.table(table).bulkGet(remote.map((r) => r.id))) as (Synced | undefined)[];
      const toApply = recordsToApply(remote, local);
      await db.table(table).bulkPut(toApply);
      applied += toApply.length;
    }

    const last = data[data.length - 1].server_updated_at as string;
    if (!cursor || last > cursor) {
      cursor = last;
      await setMeta(cursorKey, cursor);
    }
    if (data.length < PAGE || last === from) break;
    from = last;
  }
  return applied;
}

let running: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const client = supabase;
    if (!client) return;
    const { data } = await client.auth.getSession();
    if (!data.session) {
      setStatus({ phase: 'signed-out', email: null });
      return;
    }
    if (!navigator.onLine) {
      setStatus({ phase: 'offline' });
      return;
    }
    setStatus({ phase: 'syncing', email: data.session.user.email ?? null, error: null });
    try {
      await pull(client);
      for (const t of SYNCED_TABLES) await push(client, t);
      setStatus({ phase: 'idle', lastSyncedAt: Date.now() });
      await setMeta('lastSyncedAt', Date.now());
    } catch (e) {
      setStatus({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error('Sync is not configured.');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  await syncNow();
}

export async function signUp(email: string, password: string): Promise<'signed-in' | 'confirm-email'> {
  if (!supabase) throw new Error('Sync is not configured.');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  if (data.session) {
    await syncNow();
    return 'signed-in';
  }
  return 'confirm-email';
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
  // Keep local data, but make the next account sync everything from scratch.
  await db.meta.clear();
  setStatus({ phase: 'signed-out', email: null, lastSyncedAt: null });
}

let started = false;

/** Syncs on launch, when the app comes back online or to the foreground, after local changes, and every 5 minutes. */
export function startAutoSync() {
  if (started || !supabase) return;
  started = true;
  const client = supabase;

  getMeta<number>('lastSyncedAt').then((t) => t && setStatus({ lastSyncedAt: t }));
  client.auth.onAuthStateChange((_event, session: Session | null) => {
    setStatus({ email: session?.user.email ?? null, phase: session ? status.phase : 'signed-out' });
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  onLocalChange(() => {
    clearTimeout(timer);
    timer = setTimeout(syncNow, 5000);
  });
  window.addEventListener('online', () => void syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, 5 * 60_000);
  void syncNow();
}
