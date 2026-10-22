import type { Importrad } from '../domain/underlag/underlagsimport';
import type { Sha256 } from '../domain/underlag/underlag';
import { arUnderlagstyp, MAX_UNDERLAG_BYTES } from '../domain/underlag/underlag';
import type { KonteraDatabase } from './db';
import type { Skrivkontext } from './kommandon';
import { kopplaUnderlag, sparaUnderlag } from './underlag';

/** A file picked for import, with the name it was picked under. */
export interface Importfil {
  readonly namn: string;
  readonly mime: string;
  readonly data: Uint8Array;
}

export interface Avvisad {
  readonly namn: string;
  /** Swedish, and shown to the user as-is (hard rule 11). */
  readonly orsak: string;
}

export interface Underlagsimportutfall {
  /** Files stored for the first time. */
  readonly nya: number;
  /** Files whose bytes were already here, recognised by their hash. */
  readonly redanFanns: number;
  /** Links made to a verifikat. */
  readonly kopplade: number;
  /** Names imported without a link, and why. */
  readonly okopplade: readonly Avvisad[];
  /** Names not imported at all, and why. */
  readonly avvisade: readonly Avvisad[];
}

/**
 * Carries out a plan from planeraUnderlagsimport.
 *
 * One file at a time, and a file that cannot be stored is reported rather
 * than allowed to end the run: a folder of ninety receipts must not be lost
 * because the eleventh is a HEIC the archive cannot keep. What could be
 * imported is imported, and the screen says exactly what was left out.
 *
 * Safe to run twice. Files are addressed by content, so a second run finds
 * the same underlag rows and adds no duplicates, and linking is idempotent
 * (src/domain/underlag/underlag.ts) - which matters, because the realistic
 * way to use this is to pick the folder again after fixing three filenames.
 */
export async function importeraUnderlag(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  filer: readonly Importfil[],
  plan: readonly Importrad[],
  { hasha }: { hasha: (data: Uint8Array) => Promise<Sha256> },
): Promise<Underlagsimportutfall> {
  const efterNamn = new Map(plan.map((rad) => [rad.namn, rad]));

  let nya = 0;
  let redanFanns = 0;
  let kopplade = 0;
  const okopplade: Avvisad[] = [];
  const avvisade: Avvisad[] = [];

  for (const fil of filer) {
    const rad = efterNamn.get(fil.namn);
    if (rad === undefined) {
      avvisade.push({ namn: fil.namn, orsak: 'Filen fanns inte med i planen.' });
      continue;
    }

    if (!arUnderlagstyp(fil.mime)) {
      avvisade.push({
        namn: fil.namn,
        orsak: `Bokfink kan inte arkivera filtypen ${fil.mime || 'okänd'}.`,
      });
      continue;
    }
    if (fil.data.byteLength === 0) {
      avvisade.push({ namn: fil.namn, orsak: 'Filen är tom.' });
      continue;
    }
    if (fil.data.byteLength > MAX_UNDERLAG_BYTES) {
      avvisade.push({
        namn: fil.namn,
        orsak:
          `Filen är ${Math.round(fil.data.byteLength / 1024 / 1024)} MB, större än ` +
          `gränsen på ${MAX_UNDERLAG_BYTES / 1024 / 1024} MB.`,
      });
      continue;
    }

    const { underlag, nytt } = await sparaUnderlag(db, kontext, {
      sha256: await hasha(fil.data),
      mime: fil.mime,
      filnamn: rad.filnamn,
      data: fil.data,
    });
    if (nytt) {
      nya += 1;
    } else {
      redanFanns += 1;
    }

    if (rad.verifikat === undefined) {
      okopplade.push({
        namn: fil.namn,
        orsak: rad.orsak ?? 'Ingen koppling angavs.',
      });
      continue;
    }

    /*
     * Only when the link is new. Re-importing a folder must not write a
     * second identical event into the log for every file in it.
     */
    if (!underlag.verifikat.includes(rad.verifikat)) {
      await kopplaUnderlag(db, kontext, underlag.id, rad.verifikat);
      kopplade += 1;
    }
  }

  return { nya, redanFanns, kopplade, okopplade, avvisade };
}
