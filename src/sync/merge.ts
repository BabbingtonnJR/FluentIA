import type { Synced } from '../db/types';

/** Remote records that should overwrite local ones (last write wins on updatedAt). */
export function recordsToApply<T extends Synced>(remote: T[], local: (T | undefined)[]): T[] {
  return remote.filter((r, i) => {
    const l = local[i];
    return !l || l.updatedAt < r.updatedAt;
  });
}

/** Pull again slightly before the last cursor so rows committed late by a concurrent write are not missed. */
export const PULL_OVERLAP_MS = 60_000;

export function pullFrom(cursor: string | null): string {
  if (!cursor) return new Date(0).toISOString();
  return new Date(new Date(cursor).getTime() - PULL_OVERLAP_MS).toISOString();
}
