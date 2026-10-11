import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FluentiaDB } from '../db/db';
import { claimDevice, getMeta, setMeta, unsyncedCount } from './device';

let d: FluentiaDB;

beforeEach(() => {
  d = new FluentiaDB(`test-${Math.random()}`);
});

afterEach(async () => {
  await d.delete();
});

const addProgress = () => d.kv.put({ id: 'settings', value: { levels: [5] }, updatedAt: 1000 });

describe('claimDevice', () => {
  it('keeps progress made before signing in and gives it to the account', async () => {
    await addProgress();
    await claimDevice('alice', d);
    expect(await d.kv.count()).toBe(1);
    expect(await getMeta('owner', d)).toBe('alice');
  });

  it("removes another account's progress before the new one syncs", async () => {
    await claimDevice('alice', d);
    await addProgress();
    await setMeta('push:kv', 1000, d);
    await claimDevice('bob', d);
    expect(await d.kv.count()).toBe(0);
    expect(await getMeta('push:kv', d)).toBeNull();
    expect(await getMeta('owner', d)).toBe('bob');
  });

  it('leaves the same account alone', async () => {
    await claimDevice('alice', d);
    await addProgress();
    await claimDevice('alice', d);
    expect(await d.kv.count()).toBe(1);
  });
});

describe('unsyncedCount', () => {
  it('counts records changed after the last push', async () => {
    await addProgress();
    expect(await unsyncedCount(d)).toBe(1);
    await setMeta('push:kv', 1000, d);
    expect(await unsyncedCount(d)).toBe(0);
  });
});
