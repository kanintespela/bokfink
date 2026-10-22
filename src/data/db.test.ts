import 'fake-indexeddb/auto';

import type { Transaction } from 'dexie';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KonteraDatabase, MissingBackupError } from './db';
import { getOrCreateDeviceId } from './device';
import { latestSchemaVersion, schemaVersions } from './schema';

let databaseCounter = 0;

/** A fresh database name per test, so tests cannot leak state into each other. */
function uniqueName(): string {
  databaseCounter += 1;
  return `kontera-test-${databaseCounter}`;
}

const clock = () => '2026-01-15T10:00:00.000Z';

describe('KonteraDatabase', () => {
  let name: string;

  beforeEach(() => {
    name = uniqueName();
  });

  it('opens at the latest declared schema version', async () => {
    const db = new KonteraDatabase(name, { now: clock });
    await db.open();

    expect(db.verno).toBe(latestSchemaVersion());
    expect(db.tables.map((table) => table.name)).toContain('meta');

    db.close();
  });

  it('round-trips metadata', async () => {
    const db = new KonteraDatabase(name, { now: clock });
    await db.setMeta('momsperiod', 'kvartal');

    expect(await db.getMeta<string>('momsperiod')).toBe('kvartal');
    expect(await db.meta.get('momsperiod')).toEqual({
      key: 'momsperiod',
      value: 'kvartal',
      updatedAt: '2026-01-15T10:00:00.000Z',
    });

    db.close();
  });

  it('returns undefined for metadata that was never written', async () => {
    const db = new KonteraDatabase(name, { now: clock });
    expect(await db.getMeta('finns-inte')).toBeUndefined();
    db.close();
  });

  it('declares schema versions in strictly ascending order without gaps', () => {
    const versions = schemaVersions.map((entry) => entry.version);
    expect(versions).toEqual(versions.map((_, index) => index + 1));
  });
});

describe('destructive migrations', () => {
  /*
   * One version past whatever the application currently declares, rather
   * than a hardcoded number, so that these keep testing a genuinely new
   * migration every time the real schema grows.
   */
  const NASTA_VERSION = latestSchemaVersion() + 1;

  const laterSchema = (destructiveUpgrade: (tx: Transaction) => Promise<void>) =>
    [
      ...schemaVersions,
      {
        version: NASTA_VERSION,
        description: 'Rewrites metadata',
        stores: { meta: 'key' },
        destructive: true,
        upgrade: destructiveUpgrade,
      },
    ] as const;

  it('aborts and preserves data when no backup is configured', async () => {
    const name = uniqueName();

    const before = new KonteraDatabase(name, { now: clock });
    await before.setMeta('bevara', 'mig');
    before.close();

    const upgraded = new KonteraDatabase(name, {
      now: clock,
      schema: laterSchema(async (tx) => {
        await tx.table('meta').clear();
      }),
    });

    await expect(upgraded.open()).rejects.toThrow(MissingBackupError);
    upgraded.close();

    // Hard rule 8: the database must be exactly as it was.
    const after = new KonteraDatabase(name, { now: clock });
    await after.open();
    expect(after.verno).toBe(latestSchemaVersion());
    expect(await after.getMeta<string>('bevara')).toBe('mig');
    after.close();
  });

  it('takes the backup before running the upgrade', async () => {
    const name = uniqueName();
    const order: string[] = [];

    const before = new KonteraDatabase(name, { now: clock });
    await before.setMeta('bevara', 'mig');
    before.close();

    const backup = vi.fn(async () => {
      order.push('backup');
    });

    const upgraded = new KonteraDatabase(name, {
      now: clock,
      backupBeforeMigration: backup,
      schema: laterSchema(async (tx) => {
        order.push('upgrade');
        await tx.table('meta').clear();
      }),
    });

    await upgraded.open();

    expect(order).toEqual(['backup', 'upgrade']);
    expect(backup).toHaveBeenCalledWith({
      fromVersion: latestSchemaVersion(),
      toVersion: NASTA_VERSION,
      description: 'Rewrites metadata',
    });
    expect(upgraded.verno).toBe(NASTA_VERSION);
    expect(await upgraded.getMeta('bevara')).toBeUndefined();

    upgraded.close();
  });
});

describe('getOrCreateDeviceId', () => {
  it('creates an id once and reuses it afterwards', async () => {
    const db = new KonteraDatabase(uniqueName(), { now: clock });
    const newId = vi.fn(() => 'enhet-1');

    expect(await getOrCreateDeviceId(db, newId)).toBe('enhet-1');
    expect(await getOrCreateDeviceId(db, newId)).toBe('enhet-1');
    expect(newId).toHaveBeenCalledTimes(1);

    db.close();
  });
});

describe('identifiers outside a secure context', () => {
  /*
   * Regression: crypto.randomUUID() is restricted to secure contexts, so a
   * phone opening a development build over plain http:// got
   * "crypto.randomUUID is not a function" and no database at all. The e2e
   * suite could not see it because localhost counts as a secure context.
   */
  it('creates a device id when crypto.randomUUID is unavailable', async () => {
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    });

    try {
      const db = new KonteraDatabase(uniqueName(), { now: clock });
      const id = await getOrCreateDeviceId(db);

      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      db.close();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
