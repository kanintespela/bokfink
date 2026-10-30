import { formatKronor, isZero, negate, sum, type Ore } from '../belopp/ore';
import type { Datum } from '../tid/datum';
import type { Kontonummer } from '../konto/konto';
import type { Uuid } from '../id/uuidv7';
import type { Verifikatserie } from './serie';

/**
 * One line of a verifikat: an account and what it moved.
 *
 * The amount is signed, positive for debet and negative for kredit, rather
 * than kept in two columns with one of them always zero. That is how SIE
 * carries it, so import and export lose nothing, and it turns hard rule 4
 * into a single statement: the amounts in a verifikat sum to zero.
 *
 * Projekt, motpart and momskod belong here too per the data model, and
 * arrive with the entities they point at.
 */
export interface Kontering {
  readonly konto: Kontonummer;
  readonly belopp: Ore;
  /** Per-line note. SIE carries one on #TRANS and some imports use it. */
  readonly text?: string;
  /**
   * The project this line belongs to, if it belongs to one. One at most, and
   * the line stays an ordinary line without it: most are. Whether the project
   * exists and is still open is the books' to check (src/data), as the domain
   * has no register to look in.
   */
  readonly projekt?: Uuid;
}

/** A verifikat that has not been booked yet, and so has no number. */
export interface Verifikatutkast {
  readonly status: 'utkast';
  readonly id: Uuid;
  readonly datum: Datum;
  readonly beskrivning: string;
  readonly konteringar: readonly Kontering[];
  /** Set when this reverses an earlier verifikat. See {@link annullera}. */
  readonly annullerar?: Uuid;
  /**
   * The template this came from, when one did.
   *
   * Kept so the suggestion ranking can count how often each template is
   * actually used, straight from the log, without a separate tally to keep
   * in step.
   */
  readonly mall?: Uuid;
  /**
   * Why a reader suggested these accounts, when one did.
   *
   * Set by the receipt watcher, shown beside the draft so the review can
   * check the reasoning and not only the result. Never carried into the
   * booked verifikat: that records what happened, not what was thought
   * about the receipt.
   */
  readonly motivering?: string;
}

/** Where a verifikat came from, kept for traceability. */
export type Verifikatkalla = 'manuell' | 'mall' | 'sie-import';

/**
 * A verifikat that has been booked, and so carries a number that will never
 * be reused and never change.
 *
 * `datum` is when the affärshändelse happened; `bokfortDatum` is when it was
 * recorded. They differ routinely - a receipt from last month entered today -
 * and SIE keeps both on #VER for the same reason.
 */
export interface BokfortVerifikat {
  readonly status: 'bokfort';
  readonly id: Uuid;
  readonly serie: Verifikatserie;
  readonly nummer: number;
  readonly datum: Datum;
  readonly bokfortDatum: Datum;
  readonly beskrivning: string;
  readonly konteringar: readonly Kontering[];
  readonly kalla: Verifikatkalla;
  readonly annullerar?: Uuid;
  readonly mall?: Uuid;
  /**
   * Corrections made after booking, oldest first.
   *
   * Absent on everything booked before corrections existed and on everything
   * never corrected, which is the overwhelming majority - hence optional
   * rather than an empty array on every row.
   */
  readonly rattelser?: readonly Rattelse[];
}

export type Verifikat = Verifikatutkast | BokfortVerifikat;

/**
 * What may be corrected on a booked verifikat.
 *
 * Deliberately short, and it will stay short. The description is prose about
 * what the affärshändelse was, and the date is which day it belongs to;
 * neither moves an öre between accounts. The konteringar, the amount, the
 * serie and the nummer are not here and must never be - correcting those
 * changes what the books say happened, which is what bokföringslagen 5 kap.
 * 5 §'s särskild rättelsepost exists for and what Kontera does with an
 * annullering.
 */
export type Rattbartfalt = 'beskrivning' | 'datum';

/**
 * A correction made to a booked verifikat, kept beside it for good.
 *
 * Bokföringslagen 5 kap. 8 § permits a verifikation to be corrected and asks
 * for two things in return: when the correction was made and who made it.
 * Both are already carried by the log entry that records it, so they are
 * copied onto the verifikat rather than re-derived - a granskare reads the
 * ledger, and should not have to replay a log to find out that a line was
 * once different.
 *
 * The old value is kept as well as the new one. Nothing in BFL says in so
 * many words that it must be, but the whole point of a correction that can be
 * audited is that the thing corrected is still there to compare against.
 */
export interface Rattelse {
  /** ISO 8601 instant, from the log entry that carried the correction. */
  readonly nar: string;
  /** The device that made it, which is what the log knows about "who". */
  readonly enhet: string;
  readonly falt: Rattbartfalt;
  readonly fran: string;
  readonly till: string;
}

/** How a verifikat is referred to in a list or a report: "A42". */
export function beteckning(verifikat: BokfortVerifikat): string {
  return `${verifikat.serie}${verifikat.nummer}`;
}

export interface Bokforingsuppgifter {
  readonly serie: Verifikatserie;
  readonly nummer: number;
  readonly bokfortDatum: Datum;
  readonly kalla: Verifikatkalla;
}

/**
 * Turns a draft into a booked verifikat.
 *
 * The number is handed in rather than worked out here, because only the
 * ledger knows what has already been issued. See nastaVerifikationsnummer.
 *
 * The balance is checked again even though skapaUtkast already refused an
 * unbalanced draft. This is the last gate before the entry becomes permanent,
 * and hard rule 4 is worth more than the microsecond.
 */
export function bokfor(
  utkast: Verifikatutkast,
  uppgifter: Bokforingsuppgifter,
): BokfortVerifikat {
  if (!Number.isInteger(uppgifter.nummer) || uppgifter.nummer < 1) {
    throw new TypeError(
      `Verifikationsnummer måste vara ett positivt heltal, fick ${uppgifter.nummer}.`,
    );
  }

  const differens = balans(utkast.konteringar);
  if (!isZero(differens)) {
    throw new ObalanseratVerifikatError(differens);
  }

  const bokfort: BokfortVerifikat = {
    status: 'bokfort',
    id: utkast.id,
    serie: uppgifter.serie,
    nummer: uppgifter.nummer,
    datum: utkast.datum,
    bokfortDatum: uppgifter.bokfortDatum,
    beskrivning: utkast.beskrivning,
    konteringar: utkast.konteringar.map((rad) => Object.freeze({ ...rad })),
    kalla: uppgifter.kalla,
    ...(utkast.annullerar === undefined ? {} : { annullerar: utkast.annullerar }),
    ...(utkast.mall === undefined ? {} : { mall: utkast.mall }),
  };

  /*
   * Hard rule 5, enforced rather than documented. Assigning to a frozen
   * property throws in a module, which is strict by definition, so code that
   * tries to edit a booked verifikat fails where it stands instead of
   * succeeding quietly and leaving the ledger disagreeing with its own log.
   *
   * The array and every line are frozen too. Freezing only the outer object
   * would leave konteringar.push and konteringar[0].belopp wide open, which
   * is where an amount would actually be changed.
   */
  Object.freeze(bokfort.konteringar);
  return Object.freeze(bokfort);
}

/**
 * What a verifikat is "worth", for a list that shows one number per row.
 *
 * The total of the debit side. Since the lines sum to zero the two sides are
 * equal, and this is the figure a verifikationslista has shown since long
 * before anyone printed one from a computer.
 */
export function omslutning(verifikat: Verifikat): Ore {
  return sum(verifikat.konteringar.filter(arDebet).map((rad) => rad.belopp));
}

/** True when this verifikat exists to reverse an earlier one. */
export function arAnnullering(verifikat: Verifikat): boolean {
  return verifikat.annullerar !== undefined;
}

export interface Annulleringsuppgifter {
  readonly id: Uuid;
  /**
   * The day the reversal is booked on.
   *
   * Handed in rather than chosen here. Whether a correction belongs in the
   * period of the original or in the period where the mistake was found
   * depends on whether the original period is still open, which is knowledge
   * this layer does not have and a rule nobody should guess at.
   */
  readonly datum: Datum;
  readonly beskrivning?: string;
}

/**
 * Builds the draft that reverses a booked verifikat.
 *
 * Bokföringslagen 5 kap. 5 § asks that a correction to a bokföringspost be
 * traceable at a granskning, so a mistake in the posting is undone by writing
 * its mirror rather than by editing it: every line kept, every amount
 * negated. (What a verifikat says rather than does - its description and its
 * date - is corrected instead; see ratta and 5 kap. 8 §.) The pair then nets to nothing on every account it touched, which
 * is what makes the ledger readable afterwards - the original stays visible,
 * exactly as it was entered, next to the entry that cancelled it.
 *
 * The link points forwards only, from the reversal to the original. The
 * original cannot gain a field saying it was annulled, because it is frozen
 * and immutable in the ledger; the other direction is a question the ledger
 * answers by looking for a verifikat whose annullerar matches.
 */
export function annullera(
  original: BokfortVerifikat,
  uppgifter: Annulleringsuppgifter,
): Verifikatutkast {
  if (arAnnullering(original)) {
    throw new TypeError(
      `${beteckning(original)} är i sig en annullering och kan inte annulleras. ` +
        'Bokför i stället ett nytt verifikat med den kontering som ska gälla.',
    );
  }

  return {
    status: 'utkast',
    id: uppgifter.id,
    datum: uppgifter.datum,
    beskrivning:
      uppgifter.beskrivning?.trim() ??
      `Annullering av ${beteckning(original)}: ${original.beskrivning}`.trim(),
    konteringar: original.konteringar.map((rad) => ({
      ...rad,
      belopp: negate(rad.belopp),
    })),
    annullerar: original.id,
  };
}

export interface Rattelseuppgifter {
  readonly beskrivning?: string;
  readonly datum?: Datum;
  /** When the correction was made, and by which device. BFL 5 kap. 8 §. */
  readonly nar: string;
  readonly enhet: string;
}

export class TomRattelseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TomRattelseError';
  }
}

/**
 * Corrects the description or the date of a booked verifikat.
 *
 * Bokföringslagen 5 kap. 8 § allows this: "Om en verifikation rättas, skall
 * det anges när rättelsen har skett och vem som har gjort den." It asks for a
 * record of the correction, not that corrections never happen - so this
 * writes a new verifikat carrying the new value and the old one beside it,
 * and refuses to touch anything that would change what the books say
 * happened.
 *
 * Which day a corrected date may be moved to is not decided here. That
 * depends on the räkenskapsår and on whether its momsdeklaration has been
 * filed, neither of which this layer knows - see kontrolleraBokforingsbart,
 * which the caller applies to the old date as well as the new one. Moving an
 * entry out of a filed period changes a figure already reported just as
 * surely as moving one into it.
 */
export function ratta(
  original: BokfortVerifikat,
  uppgifter: Rattelseuppgifter,
): BokfortVerifikat {
  const beskrivning = uppgifter.beskrivning?.trim();
  if (beskrivning !== undefined && beskrivning.length === 0) {
    throw new TypeError(
      'En verifikation måste säga vad affärshändelsen avser (bokföringslagen ' +
        '5 kap. 7 §), så beskrivningen kan inte rättas till ingenting.',
    );
  }

  const rattelser: Rattelse[] = [];
  if (beskrivning !== undefined && beskrivning !== original.beskrivning) {
    rattelser.push({
      nar: uppgifter.nar,
      enhet: uppgifter.enhet,
      falt: 'beskrivning',
      fran: original.beskrivning,
      till: beskrivning,
    });
  }
  if (uppgifter.datum !== undefined && uppgifter.datum !== original.datum) {
    rattelser.push({
      nar: uppgifter.nar,
      enhet: uppgifter.enhet,
      falt: 'datum',
      fran: original.datum,
      till: uppgifter.datum,
    });
  }

  /*
   * A correction that corrects nothing would still be written to the log and
   * would still show up beside the verifikat as one, which turns the record
   * BFL asks for into noise. Hard rule 11: said, not swallowed.
   */
  if (rattelser.length === 0) {
    throw new TomRattelseError(
      `${beteckning(original)} har redan de uppgifterna. Ingen rättelse behövs.`,
    );
  }

  const rattat: BokfortVerifikat = {
    ...original,
    ...(beskrivning === undefined ? {} : { beskrivning }),
    ...(uppgifter.datum === undefined ? {} : { datum: uppgifter.datum }),
    rattelser: [...(original.rattelser ?? []), ...rattelser],
  };

  // Frozen exactly as bokfor leaves one: the correction produces a verifikat,
  // not a mutable draft of one.
  Object.freeze(rattat.konteringar);
  Object.freeze(rattat.rattelser);
  return Object.freeze(rattat);
}

export function arDebet(rad: Kontering): boolean {
  return rad.belopp > 0;
}

export function arKredit(rad: Kontering): boolean {
  return rad.belopp < 0;
}

/**
 * What the lines add up to. Zero means the verifikat balances.
 *
 * Anything else is the amount by which it does not, which is what the entry
 * form shows so that the person entering it can see how far off they are.
 */
export function balans(konteringar: readonly Kontering[]): Ore {
  return sum(konteringar.map((rad) => rad.belopp));
}

export function arBalanserat(konteringar: readonly Kontering[]): boolean {
  return isZero(balans(konteringar));
}

export class ObalanseratVerifikatError extends Error {
  constructor(readonly differens: Ore) {
    super(
      'Verifikatet balanserar inte. Debet och kredit skiljer sig åt med ' +
        `${formatKronor(differens)} kr, och ett verifikat som inte balanserar ` +
        'kan inte bokföras.',
    );
    this.name = 'ObalanseratVerifikatError';
  }
}

export interface Utkastuppgifter {
  readonly id: Uuid;
  readonly datum: Datum;
  readonly beskrivning: string;
  readonly konteringar: readonly Kontering[];
  readonly mall?: Uuid;
  readonly motivering?: string;
}

/**
 * Builds a draft, refusing anything that could not lawfully be booked.
 *
 * Hard rule 4 puts this check here rather than in the form: a verifikat that
 * does not balance must be impossible to construct, not merely awkward to
 * type in. Every other way into the ledger - SIE import, templates, bank
 * import - comes through the same gate.
 *
 * Lines with a zero amount are allowed. They occur in real books, including
 * the export this was built against, and rejecting them would block an
 * import of history that is otherwise sound.
 *
 * An empty beskrivning is likewise allowed, because real exports contain
 * them and history has to be importable as it stands. Bokföringslagen 5 kap.
 * 7 § requires a verifikation to say what the affärshändelse avser, so the
 * registration form asks for one; that is a rule about entering new
 * bookkeeping, not about reading in old.
 */
export function skapaUtkast(uppgifter: Utkastuppgifter): Verifikatutkast {
  const { konteringar } = uppgifter;

  if (konteringar.length < 2) {
    throw new TypeError(
      'Ett verifikat måste ha minst två konteringsrader, en debet och en kredit.',
    );
  }

  const differens = balans(konteringar);
  if (!isZero(differens)) {
    throw new ObalanseratVerifikatError(differens);
  }

  return {
    status: 'utkast',
    id: uppgifter.id,
    datum: uppgifter.datum,
    beskrivning: uppgifter.beskrivning.trim(),
    konteringar: konteringar.map((rad) => ({ ...rad })),
    ...(uppgifter.mall === undefined ? {} : { mall: uppgifter.mall }),
    ...(uppgifter.motivering === undefined || uppgifter.motivering.trim() === ''
      ? {}
      : { motivering: uppgifter.motivering.trim() }),
  };
}
