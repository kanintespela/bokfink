import { oreFromKronor, type Ore } from '../belopp/ore';
import { datum } from '../tid/datum';
import {
  skapaAnlaggningstillgang,
  type Anlaggningstillgangsuppgifter,
} from './anlaggningstillgang';
import {
  BYGGNADSPROCENT,
  MARKANLAGGNINGSPROCENT,
  type Byggnadstyp,
  type Markanlaggningstyp,
} from './byggnadsprocentsatser';
import {
  skapaFastighetstillgang,
  type Fastighetskategori,
  type Fastighetstillgangsuppgifter,
} from './fastighetstillgang';
import type { Uuid } from '../id/uuidv7';

/**
 * A register of assets kept somewhere else - a spreadsheet, another program
 * - as a file the app can take in.
 *
 * For the day the books move here: the ledger comes with a SIE file, but
 * SIE carries no register, and what is owned, since when and for how much
 * would otherwise be typed in one asset at a time.
 *
 * Amounts are kronor as text ("77734" or "9328,08"), never numbers: a JSON
 * number is a float, and no amount passes one (hard rule 1).
 */
export const REGISTERFILFORMAT = 'bokfink-anlaggningsregister';

export type Inventarierad = Omit<Anlaggningstillgangsuppgifter, 'id' | 'verifikatId'>;
export type Fastighetsrad = Omit<Fastighetstillgangsuppgifter, 'id' | 'verifikatId'> & {
  readonly ackumuleradAvskrivning: Ore;
};

export interface Registerfil {
  readonly inventarier: readonly Inventarierad[];
  readonly fastighet: readonly Fastighetsrad[];
}

export class OgiltigRegisterfilError extends Error {
  constructor(meddelande: string) {
    super(meddelande);
    this.name = 'OgiltigRegisterfilError';
  }
}

/** Stands in for the identity an entry gets when it is registered. */
const UTAN_ID = '' as Uuid;

/**
 * Reads a register file, all of it or none of it.
 *
 * Every entry is run through the same check a typed-in one gets, and the
 * first one that fails stops the whole file with its place and name in the
 * message. Half a register taken in is worse than none: what is missing
 * cannot be seen in what arrived.
 */
export function tolkaRegisterfil(text: string): Registerfil {
  let rot: unknown;
  try {
    rot = JSON.parse(text);
  } catch {
    throw new OgiltigRegisterfilError(
      'Filen är inte ett anläggningsregister från Bokfink.',
    );
  }
  if (!arObjekt(rot) || rot['format'] !== REGISTERFILFORMAT) {
    throw new OgiltigRegisterfilError(
      'Filen är inte ett anläggningsregister från Bokfink.',
    );
  }
  if (rot['version'] !== 1) {
    throw new OgiltigRegisterfilError(
      'Filen är skriven för en annan version av Bokfink. Uppdatera appen och försök igen.',
    );
  }

  const inventarier = lista(rot['inventarier'], 'inventarier').map((rad, index) =>
    tolkaRad('inventarier', index, rad, (falt) => {
      const uppgifter: Inventarierad = {
        benamning: text_(falt, 'benamning'),
        anskaffningsdatum: datum(text_(falt, 'anskaffningsdatum')),
        anskaffningsvarde: belopp(falt, 'anskaffningsvarde'),
        nyttjandeperiod: heltal(falt, 'nyttjandeperiod'),
      };
      const { benamning } = skapaAnlaggningstillgang({ id: UTAN_ID, ...uppgifter });
      return { ...uppgifter, benamning };
    }),
  );

  const fastighet = lista(rot['fastighet'], 'fastighet').map((rad, index) =>
    tolkaRad('fastighet', index, rad, (falt) => {
      const uppgifter = {
        benamning: text_(falt, 'benamning'),
        anskaffningsdatum: datum(text_(falt, 'anskaffningsdatum')),
        anskaffningsvarde: belopp(falt, 'anskaffningsvarde'),
        kategori: kategori(falt),
        ackumuleradAvskrivning:
          falt['ackumuleradAvskrivning'] === undefined
            ? oreFromKronor('0')
            : belopp(falt, 'ackumuleradAvskrivning'),
      };
      const { benamning } = skapaFastighetstillgang({ id: UTAN_ID, ...uppgifter });
      return { ...uppgifter, benamning };
    }),
  );

  if (inventarier.length + fastighet.length === 0) {
    throw new OgiltigRegisterfilError('Filen innehåller inga anläggningar.');
  }
  return { inventarier, fastighet };
}

function arObjekt(varde: unknown): varde is Record<string, unknown> {
  return varde !== null && typeof varde === 'object' && !Array.isArray(varde);
}

function lista(varde: unknown, namn: string): readonly unknown[] {
  if (varde === undefined) {
    return [];
  }
  if (!Array.isArray(varde)) {
    throw new OgiltigRegisterfilError(`"${namn}" i filen ska vara en lista.`);
  }
  return varde;
}

function tolkaRad<T>(
  lista: string,
  index: number,
  rad: unknown,
  tolka: (falt: Record<string, unknown>) => T,
): T {
  const namn =
    arObjekt(rad) && typeof rad['benamning'] === 'string' ? ` (${rad['benamning']})` : '';
  try {
    if (!arObjekt(rad)) {
      throw new TypeError('raden är inte en post.');
    }
    return tolka(rad);
  } catch (orsak) {
    throw new OgiltigRegisterfilError(
      `Rad ${index + 1} under ${lista}${namn} går inte att läsa: ` +
        (orsak instanceof Error ? orsak.message : String(orsak)),
    );
  }
}

function text_(falt: Record<string, unknown>, namn: string): string {
  const varde = falt[namn];
  if (typeof varde !== 'string') {
    throw new TypeError(`${namn} saknas.`);
  }
  return varde;
}

function belopp(falt: Record<string, unknown>, namn: string): Ore {
  const varde = falt[namn];
  if (typeof varde !== 'string') {
    throw new TypeError(
      `${namn} ska stå som text i kronor, till exempel "77734" eller "9328,08".`,
    );
  }
  return oreFromKronor(varde);
}

function heltal(falt: Record<string, unknown>, namn: string): number {
  const varde = falt[namn];
  if (typeof varde !== 'number' || !Number.isInteger(varde)) {
    throw new TypeError(`${namn} ska vara ett helt tal.`);
  }
  return varde;
}

function kategori(falt: Record<string, unknown>): Fastighetskategori {
  const typ = falt['kategori'];
  switch (typ) {
    case 'mark':
    case 'skog':
      return { typ };
    case 'byggnad': {
      const byggnadstyp = falt['byggnadstyp'];
      if (typeof byggnadstyp !== 'string' || !(byggnadstyp in BYGGNADSPROCENT)) {
        throw new TypeError(`byggnadstypen "${String(byggnadstyp)}" finns inte.`);
      }
      return { typ, byggnadstyp: byggnadstyp as Byggnadstyp };
    }
    case 'markanlaggning': {
      const markanlaggningstyp = falt['markanlaggningstyp'];
      if (
        typeof markanlaggningstyp !== 'string' ||
        !(markanlaggningstyp in MARKANLAGGNINGSPROCENT)
      ) {
        throw new TypeError(
          `markanläggningstypen "${String(markanlaggningstyp)}" finns inte.`,
        );
      }
      return { typ, markanlaggningstyp: markanlaggningstyp as Markanlaggningstyp };
    }
    default:
      throw new TypeError(
        `kategorin "${String(typ)}" finns inte. Den ska vara byggnad, markanlaggning, mark eller skog.`,
      );
  }
}
