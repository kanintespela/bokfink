import Dexie, { type Table } from 'dexie';

import { META_TABLE, type MetaRow, type SchemaVersion, schemaVersions } from './schema';

/**
 * Takes a verified backup before a destructive migration runs, and resolves
 * only once that backup is safe to rely on. Rejecting aborts the migration.
 */
export type BackupBeforeMigration = (context: {
  fromVersion: number;
  toVersion: number;
  description: string;
}) => Promise<void>;

export interface DatabaseOptions {
  /** Overridable so tests can build throwaway schemas. */
  schema?: readonly SchemaVersion[];
  backupBeforeMigration?: BackupBeforeMigration;
  /** Injected so tests are deterministic. */
  now?: () => string;
}

export class MissingBackupError extends Error {
  constructor(version: number, description: string) {
    super(
      `Migreringen till version ${version} ("${description}") ändrar eller tar bort ` +
        'befintlig data och kräver en säkerhetskopia. Migreringen avbröts och ' +
        'databasen är oförändrad.',
    );
    this.name = 'MissingBackupError';
  }
}

export class KonteraDatabase extends Dexie {
  readonly meta!: Table<MetaRow, string>;

  readonly #now: () => string;

  constructor(name = 'kontera', options: DatabaseOptions = {}) {
    super(name);

    const schema = options.schema ?? schemaVersions;
    this.#now = options.now ?? (() => new Date().toISOString());

    let previousVersion = 0;
    for (const entry of [...schema].sort((a, b) => a.version - b.version)) {
      const version = this.version(entry.version).stores(entry.stores);
      const from = previousVersion;

      if (entry.destructive || entry.upgrade) {
        version.upgrade(async (tx) => {
          if (entry.destructive) {
            const backup = options.backupBeforeMigration;
            if (!backup) {
              // Throwing inside the upgrade aborts Dexie's transaction, so the
              // database stays at its previous version with data intact.
              throw new MissingBackupError(entry.version, entry.description);
            }
            await backup({
              fromVersion: from,
              toVersion: entry.version,
              description: entry.description,
            });
          }

          await entry.upgrade?.(tx);
        });
      }

      previousVersion = entry.version;
    }
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    const row = await this.table<MetaRow, string>(META_TABLE).get(key);
    return row?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.table<MetaRow, string>(META_TABLE).put({
      key,
      value,
      updatedAt: this.#now(),
    });
  }
}
