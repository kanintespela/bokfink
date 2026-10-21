import { formatKronor, isZero, sum, type Ore } from '../belopp/ore';
import { arBalanskonto, harledKontotyp, type Kontonummer } from '../konto/konto';
import { delar, inomIntervall, jamfor, type Datum } from '../tid/datum';
import { uuidv7, type Uuid } from '../id/uuidv7';

/** The balance an account carries into the year from the one before. */
export interface Ingaendebalans {
  readonly konto: Kontonummer;
  readonly belopp: Ore;
}

/**
 * A räkenskapsår, its opening balances and how far it has been locked.
 *
 * Locking has two levels, and they are not the same thing. `momslastTom`
 * closes everything up to and including a date once a momsdeklaration has
 * been filed for it, so a later entry cannot silently change a figure already
 * reported to Skatteverket. `avslutat` closes the whole year at årsavslut.
 */
export interface Rakenskapsar {
  readonly id: Uuid;
  readonly start: Datum;
  readonly slut: Datum;
  readonly avslutat: boolean;
  readonly momslastTom?: Datum;
  readonly ingaendeBalanser: readonly Ingaendebalans[];
}

export class PeriodLastError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PeriodLastError';
  }
}

export interface Rakenskapsarsuppgifter {
  readonly id: Uuid;
  readonly start: Datum;
  readonly slut: Datum;
  readonly avslutat?: boolean;
  readonly momslastTom?: Datum;
  readonly ingaendeBalanser?: readonly Ingaendebalans[];
}

/**
 * Validates a räkenskapsår and its opening balances.
 *
 * Three things are checked, all of them cheap now and expensive to discover
 * at a bokslut:
 *
 * The year runs forwards and lasts at most eighteen months. Bokföringslag
 * (1999:1078) 3 kap. 3 §: a räkenskapsår is normally twelve months, but when
 * bookkeeping obligation begins or the year is realigned it may be shorter,
 * or extended to at most eighteen.
 *
 * Opening balances only name balance sheet accounts. A result account starts
 * every year at zero by definition, so an opening balance on one is a
 * mistake in whatever produced it.
 *
 * The opening balances sum to zero. Assets equal equity plus liabilities, and
 * with signed amounts that is simply a total of nothing. Every year in the
 * books this was built against satisfies it exactly.
 */
/*
 * A fixed pattern where a UUIDv7 keeps its random bits.
 *
 * Deliberately not random: see rakenskapsarsid below. What matters is only
 * that every device uses the same ten bytes.
 */
const STOMME = new Uint8Array([
  // "rakenskaps" in ASCII, so the constant is readable in a hex dump.
  0x72, 0x61, 0x6b, 0x65, 0x6e, 0x73, 0x6b, 0x61, 0x70, 0x73,
]);

/**
 * The identifier a fiscal year gets when nobody picked one.
 *
 * Derived from the start date rather than drawn at random, because two
 * devices that both start out empty both conclude "no year covers today" and
 * both create one - and two random identifiers for the same calendar year
 * become two years the moment the logs meet. The books then hold a 2026 with
 * the bookkeeping in it and a 2026 with nothing, and no amount of syncing
 * afterwards can tell that they were meant to be one.
 *
 * The same start date gives the same identifier on every device, so the two
 * entries fold into one row - which is what an append-only log needs from
 * anything two devices might create independently.
 *
 * The date is turned into milliseconds from its own parts rather than by
 * reading a clock, so this stays as deterministic as hard rule 3 requires.
 */
export function rakenskapsarsid(start: Datum): Uuid {
  const { ar, manad, dag } = delar(start);
  return uuidv7(Date.UTC(ar, manad - 1, dag), STOMME);
}

export function skapaRakenskapsar(uppgifter: Rakenskapsarsuppgifter): Rakenskapsar {
  const { start, slut } = uppgifter;

  if (jamfor(start, slut) >= 0) {
    throw new TypeError(
      `Räkenskapsåret måste sluta efter att det börjat, fick ${start} till ${slut}.`,
    );
  }
  if (antalManader(start, slut) > 18) {
    throw new RangeError(
      `Ett räkenskapsår får omfatta högst arton månader, ${start} till ${slut} ` +
        'är längre (bokföringslagen 3 kap. 3 §).',
    );
  }

  const ingaendeBalanser = uppgifter.ingaendeBalanser ?? [];

  for (const { konto } of ingaendeBalanser) {
    const typ = harledKontotyp(konto);
    if (typ === undefined || !arBalanskonto(typ)) {
      throw new TypeError(
        `Konto ${konto} kan inte ha en ingående balans. Endast tillgångar, ` +
          'eget kapital och skulder bär saldo mellan räkenskapsår; ett ' +
          'resultatkonto börjar varje år på noll.',
      );
    }
  }

  const differens = sum(ingaendeBalanser.map((post) => post.belopp));
  if (!isZero(differens)) {
    throw new TypeError(
      'De ingående balanserna balanserar inte. Tillgångar minus eget kapital ' +
        `och skulder blir ${formatKronor(differens)} kr i stället för noll.`,
    );
  }

  if (
    uppgifter.momslastTom !== undefined &&
    !omfattar({ start, slut }, uppgifter.momslastTom)
  ) {
    throw new RangeError(
      `Momslåsningen ${uppgifter.momslastTom} ligger utanför räkenskapsåret ` +
        `${start}–${slut}.`,
    );
  }

  return {
    id: uppgifter.id,
    start,
    slut,
    avslutat: uppgifter.avslutat ?? false,
    ingaendeBalanser: ingaendeBalanser.map((post) => ({ ...post })),
    ...(uppgifter.momslastTom === undefined
      ? {}
      : { momslastTom: uppgifter.momslastTom }),
  };
}

export function omfattar(
  ar: Pick<Rakenskapsar, 'start' | 'slut'>,
  datum: Datum,
): boolean {
  return inomIntervall(datum, ar.start, ar.slut);
}

/** True when two räkenskapsår share any day at all. */
export function overlappar(
  a: Pick<Rakenskapsar, 'start' | 'slut'>,
  b: Pick<Rakenskapsar, 'start' | 'slut'>,
): boolean {
  return a.start <= b.slut && b.start <= a.slut;
}

/** True when the day can no longer be booked into. */
export function arLast(ar: Rakenskapsar, datum: Datum): boolean {
  if (ar.avslutat) {
    return true;
  }
  return ar.momslastTom !== undefined && jamfor(datum, ar.momslastTom) <= 0;
}

/**
 * The gate every entry passes before it is booked.
 *
 * Throws rather than returning false, because there is no sensible way to
 * continue: an entry that lands in a filed period would change a figure
 * already reported, and one outside the year belongs to a different set of
 * books entirely.
 */
export function kontrolleraBokforingsbart(
  ar: Rakenskapsar,
  datum: Datum,
  paverkarMomsdeklarationen = true,
): void {
  if (!omfattar(ar, datum)) {
    throw new PeriodLastError(
      `${datum} ligger utanför räkenskapsåret ${ar.start}–${ar.slut} och kan ` +
        'inte bokföras där.',
    );
  }
  if (ar.avslutat) {
    throw new PeriodLastError(
      `Räkenskapsåret ${ar.start}–${ar.slut} är avslutat. Bokför i det år som ` +
        'är öppet, och rätta med ett nytt verifikat om något behöver justeras.',
    );
  }
  /*
   * The VAT lock exists to keep a filed momsdeklaration true, so it stops what
   * could change one and nothing else. The bokslut depends on that: its
   * periodiseringar, avskrivningar and the move of a momsfordran are dated the
   * year's last day, which the lock covers once the fourth quarter is filed.
   * Decided by the owner on 2026-09-13. Whether rows reach the declaration is
   * for the caller to say - see paverkarMomsdeklarationen in moms/momsrapport.
   */
  if (
    paverkarMomsdeklarationen &&
    ar.momslastTom !== undefined &&
    jamfor(datum, ar.momslastTom) <= 0
  ) {
    throw new PeriodLastError(
      `Perioden till och med ${ar.momslastTom} är låst eftersom momsdeklarationen ` +
        'är inlämnad. Bokför på ett datum efter låsningen.',
    );
  }
}

export class FramtidaDatumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FramtidaDatumError';
  }
}

/**
 * Refuses a verifikat dated after today.
 *
 * A booking records something that has happened, and a date in the future is
 * a slip of the thumb far more often than a plan - one that goes through
 * lands in a period nobody is looking at and turns up in the wrong
 * momsdeklaration. Decided by the owner on 2026-09-13: it should not be
 * possible at all, rather than only warned about.
 *
 * `idag` is passed in, as every date is in this layer (hard rule 3).
 */
export function kontrolleraInteFramtida(datum: Datum, idag: Datum): void {
  if (jamfor(datum, idag) > 0) {
    throw new FramtidaDatumError(
      `${datum} har inte hänt än - i dag är det ${idag}. Kontrollera datumet; det går ` +
        'inte att bokföra i förväg.',
    );
  }
}

/**
 * The day a reversal of something dated `datum` should be booked on.
 *
 * If the period the original sits in is still open, the reversal belongs
 * there: the pair then nets to nothing within the period, and neither the
 * result nor any figure already reported moves.
 *
 * If that period is closed - the momsdeklaration is filed, or the year is
 * done - it cannot be booked into at all, and the correction belongs in the
 * period where the mistake surfaced. Hence today.
 *
 * BFN's guidance on rättelser puts it the same way: correct in the period the
 * error concerns while that is possible, otherwise in the one where it was
 * found. Returns undefined when even today cannot be booked, which is a
 * question for the caller rather than something to paper over.
 */
export function datumForAnnullering(
  ar: Rakenskapsar,
  original: Datum,
  idag: Datum,
): Datum | undefined {
  if (!arLast(ar, original) && omfattar(ar, original)) {
    return original;
  }
  if (omfattar(ar, idag) && !arLast(ar, idag)) {
    return idag;
  }
  return undefined;
}

/** Whole months spanned, counting both the first and the last. */
function antalManader(start: Datum, slut: Datum): number {
  const a = delar(start);
  const b = delar(slut);
  return (b.ar - a.ar) * 12 + (b.manad - a.manad) + 1;
}
