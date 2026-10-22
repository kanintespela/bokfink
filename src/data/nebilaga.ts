import { ore, type Ore } from '../domain/belopp/ore';
import type { Uuid } from '../domain/id/uuidv7';
import { JUSTERINGAR, type Justeringsrad } from '../domain/skatt/nebilaga';
import type { KonteraDatabase } from './db';

/**
 * What the NE-bilaga needs that is not in the books: the adjustments on
 * page 2 for each year, and who is filing.
 *
 * Kept as metadata, like the box choices in rutval.ts. They are figures on a
 * tax form, not bookkeeping, and metadata travels with a backup. A value
 * read back that is not a whole number of öre for a known row is left out,
 * so the field shows empty rather than wrong.
 */

export interface Deklarantuppgifter {
  readonly personnummer: string;
  readonly namn: string;
  readonly adress: string;
  readonly postnummer: string;
  readonly postort: string;
  readonly verksamhetensArt: string;
}

const DEKLARANT = 'ne.deklarant';

const justeringsnyckel = (arId: Uuid) => `ne.justeringar.${arId}`;
const KANDA_RADER = new Set<string>(JUSTERINGAR.map((post) => post.rad));

export async function lasDeklarant(db: KonteraDatabase): Promise<Deklarantuppgifter> {
  const sparat =
    await db.getMeta<Partial<Record<keyof Deklarantuppgifter, unknown>>>(DEKLARANT);
  const falt = (nyckel: keyof Deklarantuppgifter): string => {
    const varde = sparat?.[nyckel];
    return typeof varde === 'string' ? varde : '';
  };
  return {
    personnummer: falt('personnummer'),
    namn: falt('namn'),
    adress: falt('adress'),
    postnummer: falt('postnummer'),
    postort: falt('postort'),
    verksamhetensArt: falt('verksamhetensArt'),
  };
}

export async function sparaDeklarant(
  db: KonteraDatabase,
  uppgifter: Deklarantuppgifter,
): Promise<void> {
  await db.setMeta(DEKLARANT, { ...uppgifter });
}

export async function lasNejusteringar(
  db: KonteraDatabase,
  arId: Uuid,
): Promise<Partial<Record<Justeringsrad, Ore>>> {
  const sparat = await db.getMeta<Record<string, unknown>>(justeringsnyckel(arId));
  const ut: Partial<Record<Justeringsrad, Ore>> = {};
  for (const [rad, varde] of Object.entries(sparat ?? {})) {
    if (KANDA_RADER.has(rad) && typeof varde === 'number' && Number.isInteger(varde)) {
      ut[rad as Justeringsrad] = ore(varde);
    }
  }
  return ut;
}

/** Zero is not stored; an empty field and a zero say the same on the form. */
export async function sparaNejusteringar(
  db: KonteraDatabase,
  arId: Uuid,
  justeringar: Partial<Record<Justeringsrad, Ore>>,
): Promise<void> {
  const ut: Record<string, number> = {};
  for (const [rad, varde] of Object.entries(justeringar)) {
    if (!KANDA_RADER.has(rad)) {
      throw new TypeError(`${rad} är ingen rad på NE-bilagans sida 2.`);
    }
    if (varde !== undefined && varde !== 0) {
      ut[rad] = varde;
    }
  }
  await db.setMeta(justeringsnyckel(arId), ut);
}
