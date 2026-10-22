import type { KonteraDatabase } from './db';

/** The metadata key a database's book identity is kept under. */
export const BOK_ID_NYCKEL = 'bokId';

/**
 * The identity of the books every database held before there could be more
 * than one set of them.
 *
 * Fixed rather than minted, because that first book already lives on several
 * devices that have been exchanging backups for months. An identity created
 * on each of them would differ, and the next backup moved between the phone
 * and the computer would be refused as coming from someone else's books.
 */
export const URSPRUNGLIG_BOK = 'kontera';

/**
 * Which books a database holds.
 *
 * Each book is a database of its own, and a backup carries its book's identity in the metadata, so a restore can tell
 * a copy of the association's books from a copy of the firm's before it
 * merges one into the other. A database without one holds the original book.
 */
export async function lasBokId(db: KonteraDatabase): Promise<string> {
  return (await db.getMeta<string>(BOK_ID_NYCKEL)) ?? URSPRUNGLIG_BOK;
}

/** The identity carried by a backup's metadata, read the same way. */
export function bokIdIMeta(meta: readonly { key: string; value: unknown }[]): string {
  const rad = meta.find((kandidat) => kandidat.key === BOK_ID_NYCKEL);
  return typeof rad?.value === 'string' ? rad.value : URSPRUNGLIG_BOK;
}
