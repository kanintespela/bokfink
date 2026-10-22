import type { Uuid } from '../id/uuidv7';
import type { Rakenskapsar } from '../rakenskapsar/rakenskapsar';
import type { BokfortVerifikat } from '../verifikat/verifikat';

/**
 * Bulk import of underlag that already belong to booked verifikat.
 *
 * The case this exists for is leaving another bookkeeping service: the
 * verifikat arrive as SIE and the receipts arrive as a folder of files, and
 * nothing in either half says which picture belongs to which booking. Rather
 * than a second manifest file that can drift away from the folder, the link
 * travels in the filename:
 *
 *     2025-A50-hosilage.pdf   ->  räkenskapsåret som börjar 2025, verifikat A50
 *
 * A folder is a thing a person can inspect, sort and correct in any file
 * manager, and a name that carries its own meaning survives being copied,
 * zipped and mailed. Anything that does not parse is still imported - as an
 * underlag without a link, because evidence is worth keeping even when the
 * automatic half of this could not place it (hard rule 10: the import
 * proposes, and the screen shows what it intends to do before anything is
 * written).
 */

/*
 * What the extensions mean.
 *
 * The browser usually states a picked file's type, but not always: a file
 * reached through iOS Files, or from a filesystem with no type database
 * behind it, arrives with an empty type and would be refused as unarchivable
 * although it is a perfectly ordinary PDF. The extension is then the only
 * thing left, and for the four types an archive may hold it is enough.
 */
const ANDELSER: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/** The type a file's name suggests, for when the browser states none. */
export function mimeAvFilnamn(namn: string): string | undefined {
  const andelse = namn.split('.').pop()?.toLowerCase();
  return andelse === undefined ? undefined : ANDELSER[andelse];
}

/** What an import filename claims about the file. */
export interface Underlagsnamn {
  /** The calendar year the räkenskapsår starts in, as four digits. */
  readonly ar: string;
  readonly serie: string;
  readonly nummer: number;
  /** The filename with the verifikat prefix removed. */
  readonly filnamn: string;
}

/*
 * The number follows the series immediately, the way a verifikat is spoken
 * about: A50. The rest is the file's own name, which may contain anything a
 * filesystem allows - dashes included, so only the first two dashes separate.
 *
 * Series are letters here, although verifikatserie also allows digits
 * (src/domain/verifikat/serie.ts). A series that ended in a digit would make
 * "A15" mean either A1 number 5 or A number 15, and a filename that can be
 * read two ways is worse than one that refuses to be read: such a file is
 * imported unlinked and can be attached by hand.
 */
const NAMN = /^(\d{4})-([A-ZÅÄÖ]{1,4})(\d+)-(.+)$/u;

/** Reads a filename, or returns undefined when it carries no verifikat. */
export function tolkaUnderlagsnamn(namn: string): Underlagsnamn | undefined {
  const traff = NAMN.exec(namn);
  if (traff === null) {
    return undefined;
  }
  const [, ar, serie, nummer, filnamn] = traff;
  if (
    ar === undefined ||
    serie === undefined ||
    nummer === undefined ||
    filnamn === undefined
  ) {
    return undefined;
  }
  return { ar, serie, nummer: Number(nummer), filnamn };
}

export interface Importrad {
  /** The file as it was picked, so the screen can name it back to the user. */
  readonly namn: string;
  /** What the underlag will be called once stored. */
  readonly filnamn: string;
  /** The verifikat it will be linked to, when one was found. */
  readonly verifikat?: Uuid;
  /** How the verifikat is written for a human: "A50". */
  readonly beteckning?: string;
  /** Why no link was made. Shown as-is, in Swedish (hard rule 11). */
  readonly orsak?: string;
}

/**
 * Works out what an import would do, without doing any of it.
 *
 * Pure on purpose: the screen shows this list and waits for a yes, and a
 * plan that can be computed twice with the same answer is what makes that
 * preview worth trusting.
 *
 * The year in the name is the räkenskapsår's starting year rather than the
 * verifikat's date, because verifikatnummer run per series and per fiscal
 * year (hard rule 6) and a broken fiscal year would otherwise place A50 in
 * two different books.
 */
export function planeraUnderlagsimport(
  namn: readonly string[],
  verifikat: readonly BokfortVerifikat[],
  rakenskapsar: readonly Rakenskapsar[],
): readonly Importrad[] {
  return namn.map((fil) => {
    const tolkat = tolkaUnderlagsnamn(fil);
    if (tolkat === undefined) {
      return {
        namn: fil,
        filnamn: fil,
        orsak: 'Filnamnet säger inget verifikat. Underlaget sparas okopplat.',
      };
    }

    const ar = rakenskapsar.find((kandidat) => kandidat.start.slice(0, 4) === tolkat.ar);
    if (ar === undefined) {
      return {
        namn: fil,
        filnamn: tolkat.filnamn,
        orsak: `Det finns inget räkenskapsår som börjar ${tolkat.ar}.`,
      };
    }

    const traff = verifikat.find(
      (kandidat) =>
        kandidat.serie === tolkat.serie &&
        kandidat.nummer === tolkat.nummer &&
        kandidat.datum >= ar.start &&
        kandidat.datum <= ar.slut,
    );
    if (traff === undefined) {
      return {
        namn: fil,
        filnamn: tolkat.filnamn,
        orsak: `Verifikat ${tolkat.serie}${tolkat.nummer} finns inte i ${tolkat.ar}.`,
      };
    }

    return {
      namn: fil,
      filnamn: tolkat.filnamn,
      verifikat: traff.id,
      beteckning: `${tolkat.serie}${tolkat.nummer}`,
    };
  });
}
