import { tolkaBokprofil, type Bokprofil } from '../domain/bok/bokprofil';
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

/** The metadata key a database's book profile is kept under. */
export const BOK_PROFIL_NYCKEL = 'bokprofil';

/**
 * What kind of books a database holds.
 *
 * Kept next to the identity, in the book's own metadata, rather than in the
 * register: a backup carries it, so a book restored onto a new device is the
 * same kind of book, and clearing the register cannot turn an association into
 * a firm. A database that recorded none is a book from before there were two
 * kinds, and a firm's.
 */
export async function lasBokprofil(db: KonteraDatabase): Promise<Bokprofil> {
  return tolkaBokprofil(await db.getMeta<unknown>(BOK_PROFIL_NYCKEL));
}

/** The profile carried by a backup's metadata, read the same way. */
export function bokprofilIMeta(
  meta: readonly { key: string; value: unknown }[],
): Bokprofil {
  return tolkaBokprofil(
    meta.find((kandidat) => kandidat.key === BOK_PROFIL_NYCKEL)?.value,
  );
}
