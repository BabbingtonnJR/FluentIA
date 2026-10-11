import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { db, SYNCED_TABLES, type SyncedTable } from '../db/db';
import { claimDevice, getMeta, setMeta, unsyncedCount, wipeLocal } from './device';
import type { Synced } from '../db/types';
import { onLocalChange } from './events';
import { pullFrom, recordsToApply } from './merge';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

/** `checking` until the saved session (if any) has been read; then the app either opens or asks to sign in. */
export type SyncPhase = 'unconfigured' | 'checking' | 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  email: string | null;
  lastSyncedAt: number | null;
  error: string | null;
  /** Opened from a password reset email: the user must choose a new password. */
  recovering: boolean;
}

let status: SyncStatus = {
  phase: supabase ? 'checking' : 'unconfigured',
  email: null,
  lastSyncedAt: null,
  error: null,
  recovering: false,
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
    const email = data.session.user.email ?? null;
    await claimDevice(data.session.user.id);
    if (!navigator.onLine) {
      setStatus({ phase: 'offline', email });
      return;
    }
    setStatus({ phase: 'syncing', email, error: null });
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

/** A sync that starts after any one in progress, so it sees the session that was just created. */
async function freshSync() {
  if (running) await running;
  await syncNow();
}

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error('Accounts are not configured.');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  await freshSync();
}

export async function signUp(email: string, password: string): Promise<'signed-in' | 'confirm-email'> {
  if (!supabase) throw new Error('Accounts are not configured.');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  if (data.session) {
    await freshSync();
    return 'signed-in';
  }
  return 'confirm-email';
}

/**
 * Signs out after a last sync and removes this account's data from the device (it stays on the
 * server). Returns how many changes would be lost because they could not be synced; with `force`
 * unset and changes pending, nothing happens so the caller can ask first.
 */
export async function signOut({ force = false } = {}): Promise<number> {
  if (!supabase) return 0;
  if (navigator.onLine) await syncNow();
  const pending = await unsyncedCount();
  if (pending && !force) return pending;
  await supabase.auth.signOut({ scope: 'local' });
  await wipeLocal();
  setStatus({ phase: 'signed-out', email: null, lastSyncedAt: null, error: null });
  return 0;
}

/** Sends a link that opens the app to choose a new password. */
export async function sendPasswordReset(email: string) {
  if (!supabase) throw new Error('Accounts are not configured.');
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
  if (error) throw new Error(error.message);
}

export async function setNewPassword(password: string) {
  if (!supabase) throw new Error('Accounts are not configured.');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
  setStatus({ recovering: false });
  await syncNow();
}

let started = false;

/** Syncs on launch, when the app comes back online or to the foreground, after local changes, and every 5 minutes. */
export function startAutoSync() {
  if (started || !supabase) return;
  started = true;
  const client = supabase;

  getMeta<number>('lastSyncedAt').then((t) => t && setStatus({ lastSyncedAt: t }));
  client.auth.onAuthStateChange((event, session: Session | null) => {
    setStatus({ email: session?.user.email ?? null, phase: session ? status.phase : 'signed-out' });
    if (event === 'PASSWORD_RECOVERY') setStatus({ recovering: true });
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
