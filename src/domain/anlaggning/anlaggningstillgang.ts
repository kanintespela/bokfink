import { isZero, type Ore } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import { jamfor, type Datum } from '../tid/datum';

/**
 * A machine or inventarie kept in the register (BFN K1 punkt 6.1,
 * "förteckning över anläggningstillgångar").
 *
 * The register exists for traceability and for kompletteringsregeln, which
 * needs each item's own acquisition value and age - not because the value
 * in the books is tracked per item. Maskiner och inventarier are written off
 * as one collective pool (punkt 6.38); see avskrivning.ts.
 */
export interface Anlaggningsavyttring {
  readonly datum: Datum;
  readonly typ: 'forsaljning' | 'utrangering';
  /** Zero for an utrangering - nothing was sold, so nothing came back. */
  readonly forsaljningsinkomst: Ore;
}

export interface Anlaggningstillgang {
  readonly id: Uuid;
  readonly benamning: string;
  readonly anskaffningsdatum: Datum;
  readonly anskaffningsvarde: Ore;
  /** Whole years, the basis for the ≤3-year direktavdrag test (punkt 6.31). */
  readonly nyttjandeperiod: number;
  readonly avyttring?: Anlaggningsavyttring;
}

export interface Anlaggningstillgangsuppgifter {
  readonly id: Uuid;
  readonly benamning: string;
  readonly anskaffningsdatum: Datum;
  readonly anskaffningsvarde: Ore;
  readonly nyttjandeperiod: number;
}

export function skapaAnlaggningstillgang(
  uppgifter: Anlaggningstillgangsuppgifter,
): Anlaggningstillgang {
  const benamning = uppgifter.benamning.trim();
  if (benamning === '') {
    throw new TypeError('En anläggningstillgång måste ha en benämning.');
  }
  if (uppgifter.anskaffningsvarde <= 0) {
    throw new RangeError(
      `Anskaffningsvärdet måste vara större än noll, fick ${uppgifter.anskaffningsvarde} öre.`,
    );
  }
  if (!Number.isInteger(uppgifter.nyttjandeperiod) || uppgifter.nyttjandeperiod <= 0) {
    throw new RangeError(
      `Nyttjandeperioden måste vara ett helt antal år, fick ${uppgifter.nyttjandeperiod}.`,
    );
  }

  return {
    id: uppgifter.id,
    benamning,
    anskaffningsdatum: uppgifter.anskaffningsdatum,
    anskaffningsvarde: uppgifter.anskaffningsvarde,
    nyttjandeperiod: uppgifter.nyttjandeperiod,
  };
}

/**
 * Direktavdrag: BFN K1 punkt 6.30 (anskaffningsvärdet, inklusive icke
 * avdragsgill moms, understiger ett halvt prisbasbelopp) eller punkt 6.31
 * (nyttjandeperioden är högst tre år). Endera villkoret räcker - en tillgång
 * som klarar det här läggs aldrig i registret utan bokförs som en vanlig
 * kostnad.
 */
export function kravsDirektavdrag(
  anskaffningsvardeInklOavdragsgillMoms: Ore,
  nyttjandeperiod: number,
  halvtPrisbasbelopp: Ore,
): boolean {
  return (
    anskaffningsvardeInklOavdragsgillMoms <= halvtPrisbasbelopp || nyttjandeperiod <= 3
  );
}

export class RedanAvyttradError extends Error {
  constructor(benamning: string) {
    super(`"${benamning}" är redan avyttrad och kan inte avyttras en gång till.`);
    this.name = 'RedanAvyttradError';
  }
}

/**
 * Marks an asset sold or scrapped. The register keeps the entry - punkt 6.1
 * only asks that a gone asset be struck once it no longer exists in the
 * företaget, and "struck" here means marked, not deleted, so the pool
 * calculation for the year it left can still find it.
 */
export function avyttra(
  tillgang: Anlaggningstillgang,
  avyttring: Anlaggningsavyttring,
): Anlaggningstillgang {
  if (tillgang.avyttring !== undefined) {
    throw new RedanAvyttradError(tillgang.benamning);
  }
  if (jamfor(avyttring.datum, tillgang.anskaffningsdatum) < 0) {
    throw new RangeError(
      `"${tillgang.benamning}" kan inte avyttras ${avyttring.datum}, före sitt eget ` +
        `anskaffningsdatum ${tillgang.anskaffningsdatum}.`,
    );
  }
  if (avyttring.typ === 'utrangering' && !isZero(avyttring.forsaljningsinkomst)) {
    throw new RangeError(
      'En utrangering har ingen försäljningsinkomst - använd "forsaljning" om ' +
        'tillgången faktiskt gav något tillbaka.',
    );
  }

  return { ...tillgang, avyttring };
}
