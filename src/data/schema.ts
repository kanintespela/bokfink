import type { Transaction } from 'dexie';

/**
 * One numbered step in the database's history.
 *
 * Every schema change is appended here as a new entry and never edited in
 * place: an installed app upgrades by replaying the steps it has not seen yet,
 * so rewriting an old step would mean different devices ending up with
 * different databases while both claim the same version.
 */
export interface SchemaVersion {
  readonly version: number;
  /** What this step changes, in one line, for whoever reads the history later. */
  readonly description: string;
  /** Dexie store definitions. `null` drops a table. */
  readonly stores: Readonly<Record<string, string | null>>;
  /**
   * True when the step drops a table, drops an index that data depends on, or
   * rewrites existing rows.
   *
   * Hard rule 8: a destructive migration refuses to run unless a verified
   * backup was taken first. The database enforces that rather than trusting
   * whoever writes the migration to remember.
   */
  readonly destructive?: boolean;
  readonly upgrade?: (tx: Transaction) => Promise<void>;
}

/** A row in the key/value table holding application metadata. */
export interface MetaRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

export const META_TABLE = 'meta';

export const HANDELSE_TABLE = 'handelse';
export const KONTO_TABLE = 'konto';
export const RAKENSKAPSAR_TABLE = 'rakenskapsar';
export const UTKAST_TABLE = 'utkast';
export const VERIFIKAT_TABLE = 'verifikat';
export const MALL_TABLE = 'konteringsmall';
export const UNDERLAG_TABLE = 'underlag';
export const FIL_TABLE = 'fil';
export const SYNKKO_TABLE = 'synkko';
export const ANLAGGNING_TABLE = 'anlaggning';
export const FASTIGHET_TABLE = 'fastighet';
export const DJURLAGER_TABLE = 'djurlager';
export const PROJEKT_TABLE = 'projekt';

export const schemaVersions: readonly SchemaVersion[] = [
  {
    version: 1,
    description: 'Application metadata only. Bookkeeping tables arrive in stage 1.',
    stores: {
      [META_TABLE]: 'key',
    },
  },
  {
    version: 2,
    description: 'The event log and the tables it materialises.',
    stores: {
      /*
       * The log is keyed by its UUIDv7, so the primary index is already
       * chronological: reading it in key order is replaying it in the order
       * entries were made. `enhet` is indexed because sync asks which device
       * an entry came from, and `typ` because the audit views filter on it.
       */
      [HANDELSE_TABLE]: 'id, enhet, typ',

      /*
       * Everything below is a view of the log and can be dropped and rebuilt
       * from it. That is what makes them safe to reshape later without a
       * destructive migration.
       */
      // `favorit` and `aktiv` are deliberately not indexed. IndexedDB has no
      // boolean key type, so such an index silently holds nothing; a few
      // hundred accounts are filtered in memory instead.
      [KONTO_TABLE]: 'nummer, typ',
      [RAKENSKAPSAR_TABLE]: 'id, start',
      [UTKAST_TABLE]: 'id, datum',
      /*
       * The unique compound index is hard rule 6 enforced by the storage
       * layer rather than trusted to the code above it: a series cannot hand
       * out the same number twice.
       *
       * It is scoped by räkenskapsår because the rule is. Series A restarts
       * at 1 every year, so the books being imported contain A1 four times
       * over - a globally unique [serie+nummer] would reject three of them.
       */
      [VERIFIKAT_TABLE]:
        'id, &[rakenskapsarId+serie+nummer], datum, serie, rakenskapsarId, annullerar',
    },
  },
  {
    version: 3,
    description: 'Konteringsmallar, the normal way to book.',
    stores: {
      // Also a view of the log. `riktning` is indexed because the entry form
      // asks for one side at a time; the name is searched in memory, since
      // matching folds accents and no index can do that.
      [MALL_TABLE]: 'id, riktning',
    },
  },
  {
    version: 4,
    description: 'Underlag, and the files they point at.',
    stores: {
      /*
       * A view of the log like the others. `sha256` is indexed because that
       * is how a file is recognised as one already stored, and `*verifikat`
       * is a multiEntry index so the question "what evidence does this
       * verifikat have" is one lookup rather than a scan - an underlag can
       * belong to several verifikat and the other way round.
       */
      [UNDERLAG_TABLE]: 'id, sha256, *verifikat',

      /*
       * The one table that is not a view of the log, and the only one that
       * could not be rebuilt from it.
       *
       * Photographs are megabytes. A log carrying them could not be replayed
       * cheaply, synchronised as the small append-only record it is, or read
       * as JSON - so the bytes live here instead, addressed by their own
       * SHA-256, and the log carries the address. Storing the same receipt
       * twice therefore costs nothing, which is what makes both a second
       * photograph and a second device free.
       *
       * The consequence is that a backup has to carry this table explicitly.
       * Losing it would mean bookkeeping without its evidence.
       */
      [FIL_TABLE]: 'sha256',
    },
  },
  {
    version: 5,
    description: 'The queue of entries the sync server has not seen.',
    stores: {
      /*
       * What is left to send, and nothing else.
       *
       * The log itself cannot answer "what does the server already have":
       * entries arrive from two directions, and a high-water mark over
       * UUIDv7 breaks the moment a device that was offline for a week sends
       * entries with older ids than ones already pushed.
       *
       * So a queue: every entry written locally goes in, and comes out when
       * the server has confirmed it. Entries that arrived from the server
       * never go in - they are already there by definition. The table is
       * empty in a synchronised installation, which is also what makes
       * "everything is sent" cheap to answer.
       */
      [SYNKKO_TABLE]: 'id',
    },
  },
  {
    version: 6,
    description: 'Anläggningsregistret för maskiner och inventarier (Etapp 7).',
    stores: {
      // A view of the log like the others. Indexed only on id - the register
      // is read whole (it feeds a collective pool calculation, not a lookup
      // by one field) and stays small enough that scanning it in memory for
      // "still held" costs nothing worth an index.
      [ANLAGGNING_TABLE]: 'id',
    },
  },
  {
    version: 7,
    description:
      'Fastighetskomponenter (byggnad/markanläggning/mark/skog) och djurlager (Etapp 7).',
    stores: {
      [FASTIGHET_TABLE]: 'id',
      [DJURLAGER_TABLE]: 'id',
    },
  },
  {
    version: 8,
    description: 'Projekt, which a konteringsrad can be booked on (Etapp 10).',
    stores: {
      // A view of the log like the others, and so safe to rebuild. Read whole:
      // a handful of projects, looked up by id from the rows that point at them.
      [PROJEKT_TABLE]: 'id',
    },
  },
];

/** The version an up-to-date database is expected to be at. */
export function latestSchemaVersion(
  versions: readonly SchemaVersion[] = schemaVersions,
): number {
  return versions.reduce((highest, entry) => Math.max(highest, entry.version), 0);
}
