import { kontrolleraPrisbasbelopp } from '../domain/skatt/skattetabell';
import type { Ore } from '../domain/belopp/ore';
import type { KonteraDatabase } from './db';

const NYCKEL = 'skattetal.prisbasbelopp';

/**
 * The prisbasbelopp the owner has added for years the app does not ship with.
 *
 * Kept as metadata, like the other settings: it is a figure a calculation is
 * offered with, never something the books say, and metadata travels with a
 * backup. Each device keeps its own - fetching it is one tap.
 */
export async function lasEgnaPrisbasbelopp(
  db: KonteraDatabase,
): Promise<ReadonlyMap<number, Ore>> {
  const sparat = await db.getMeta<Record<string, number>>(NYCKEL);
  const egna = new Map<number, Ore>();
  for (const [ar, belopp] of Object.entries(sparat ?? {})) {
    try {
      kontrolleraPrisbasbelopp(belopp as Ore);
      egna.set(Number(ar), belopp as Ore);
    } catch {
      // A hand-edited backup with a figure that cannot be one is left out; the
      // screen then asks for the year again, where the owner will see it.
    }
  }
  return egna;
}

export async function sparaPrisbasbelopp(
  db: KonteraDatabase,
  ar: number,
  belopp: Ore,
): Promise<void> {
  if (!Number.isInteger(ar) || ar < 1960 || ar > 2200) {
    throw new RangeError(`${ar} är inget år att lägga in ett prisbasbelopp för.`);
  }
  kontrolleraPrisbasbelopp(belopp);
  const sparat = (await db.getMeta<Record<string, number>>(NYCKEL)) ?? {};
  await db.setMeta(NYCKEL, { ...sparat, [String(ar)]: belopp });
}
