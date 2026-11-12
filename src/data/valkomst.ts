import { arEnbartStartdata, forberedBokforing, slappStartdata } from './uppstart';
import {
  BOK_BRANSCH_NYCKEL,
  BOK_PROFIL_NYCKEL,
  lasBokId,
  lasBokprofil,
  URSPRUNGLIG_BOK,
} from './bokidentitet';
import { lasLogg } from './bokforing';
import type { BokfinkDatabase } from './db';
import type { Skrivkontext } from './kommandon';
import type { Bokprofil } from '../domain/bok/bokprofil';
import type { Bransch } from '../domain/bok/bransch';
import type { Momsperiod } from '../domain/moms/period';
import type { Klocka } from '../domain/tid/klocka';

/** Set when the welcome screen has been answered or put aside. */
export const VALKOMST_KLAR_NYCKEL = 'uppstart.klar';

/**
 * Whether the first book is still the blank one the welcome screen is for.
 *
 * Only the original book, only while nothing but the starter set has been
 * written to it and the screen has not been dealt with. A book someone has
 * booked in, restored a backup into or created by name is never asked again.
 */
export async function skaVisaValkomst(db: BokfinkDatabase): Promise<boolean> {
  if ((await lasBokId(db)) !== URSPRUNGLIG_BOK) {
    return false;
  }
  if ((await db.getMeta<boolean>(VALKOMST_KLAR_NYCKEL)) === true) {
    return false;
  }
  return arEnbartStartdata(await lasLogg(db));
}

/** Puts the welcome screen aside without answering it, so it is not shown again. */
export async function hoppaOverValkomst(db: BokfinkDatabase): Promise<void> {
  await db.setMeta(VALKOMST_KLAR_NYCKEL, true);
}

export interface Valkomstsvar {
  readonly profil: Bokprofil;
  /** For an association: whether it is registered for moms. A firm always is. */
  readonly momsregistrerad: boolean;
  readonly momsperiod: Momsperiod;
  /** What a firm does; an association has none. */
  readonly bransch?: Bransch;
}

export class ValkomstEjMojligError extends Error {
  constructor() {
    super(
      'Boken har redan något bokfört eller sparat i sig, så vad den är för slags bok ' +
        'går inte att ändra längre.',
    );
    this.name = 'ValkomstEjMojligError';
  }
}

/**
 * Sets up the blank first book as what its owner said it is.
 *
 * A book's kind is fixed from the day something is written to it
 * (bokprofil.ts): the accounts, the questions and the year-end differ, and
 * hard rule 5 leaves no way to correct a verifikat booked under the wrong
 * rules. The first book is the one place the kind can still be chosen, because
 * it starts as a firm's by default and holds nothing but the starter set until
 * this runs. If it holds anything else this refuses, and changes nothing.
 *
 * Changing to an association replaces the firm's starter accounts with the
 * association's. That is safe for the reason it is allowed at all: the starter
 * set is not something anyone made (arEnbartStartdata).
 */
export async function genomforValkomst(
  db: BokfinkDatabase,
  kontext: Skrivkontext,
  klocka: Klocka,
  svar: Valkomstsvar,
): Promise<void> {
  if (!arEnbartStartdata(await lasLogg(db))) {
    throw new ValkomstEjMojligError();
  }
  if ((await lasBokprofil(db)) !== svar.profil) {
    await slappStartdata(db);
    await db.setMeta(BOK_PROFIL_NYCKEL, svar.profil);
    await forberedBokforing(db, kontext, klocka);
  }
  await db.setMeta('momsperiod', svar.momsperiod);
  if (svar.profil === 'enskild_firma' && svar.bransch !== undefined) {
    await db.setMeta(BOK_BRANSCH_NYCKEL, svar.bransch);
  }
  if (svar.profil === 'forening') {
    await db.setMeta('momsregistrerad', svar.momsregistrerad);
  }
  await hoppaOverValkomst(db);
}
