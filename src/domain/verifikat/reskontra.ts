import { isZero, negate, subtract, sum, ZERO, type Ore } from '../belopp/ore';
import { kontonummer, type Kontonummer } from '../konto/konto';
import type { Datum } from '../tid/datum';
import type { Uuid } from '../id/uuidv7';
import {
  arAnnullering,
  skapaUtkast,
  type BokfortVerifikat,
  type Verifikatutkast,
} from './verifikat';

/**
 * The open invoices of a book kept with faktureringsmetoden.
 *
 * Under that method an invoice is booked on the day it is written, as a
 * receivable (1500) or a payable (2440), and the payment is a second
 * verifikat that settles it. There is no customer register: an invoice is
 * the verifikat that holds the receivable or the payable, and what has been
 * paid on it is the verifikat that point back at it (`betalar`).
 *
 * Which verifikat is an invoice: one booked from a template - the Bokför
 * flow - with a debit on 1500 or a credit on 2440. A year-end periodisering
 * has the same accounts but is not made from a template, and is left alone.
 * A credit note (a credit on 1500) is not an invoice and is not listed; it
 * is booked as a negative amount and stands on its own.
 */
export const KUNDFORDRAN = kontonummer('1500');
export const LEVERANTORSSKULD = kontonummer('2440');

export type Fakturaslag = 'kund' | 'leverantor';

export interface Faktura {
  readonly verifikat: BokfortVerifikat;
  readonly slag: Fakturaslag;
  readonly konto: Kontonummer;
  /** What the invoice came to, as a positive amount. */
  readonly belopp: Ore;
  readonly betalt: Ore;
  readonly kvar: Ore;
}

function fakturarad(
  verifikat: BokfortVerifikat,
): { slag: Fakturaslag; belopp: Ore } | undefined {
  if (verifikat.mall === undefined || arAnnullering(verifikat)) {
    return undefined;
  }
  const kund = sum(
    verifikat.konteringar
      .filter((rad) => rad.konto === KUNDFORDRAN && rad.belopp > ZERO)
      .map((rad) => rad.belopp),
  );
  if (!isZero(kund)) {
    return { slag: 'kund', belopp: kund };
  }
  const lev = sum(
    verifikat.konteringar
      .filter((rad) => rad.konto === LEVERANTORSSKULD && rad.belopp < ZERO)
      .map((rad) => negate(rad.belopp)),
  );
  return isZero(lev) ? undefined : { slag: 'leverantor', belopp: lev };
}

/** Every invoice, paid or not, oldest first. */
export function fakturor(alla: readonly BokfortVerifikat[]): Faktura[] {
  const annullerade = new Set(
    alla.flatMap((verifikat) =>
      verifikat.annullerar === undefined ? [] : [verifikat.annullerar],
    ),
  );
  const levande = alla.filter((verifikat) => !annullerade.has(verifikat.id));

  return levande
    .flatMap((verifikat): Faktura[] => {
      const rad = fakturarad(verifikat);
      if (rad === undefined) {
        return [];
      }
      const konto = rad.slag === 'kund' ? KUNDFORDRAN : LEVERANTORSSKULD;
      const betalt = sum(
        levande
          .filter((betalning) => betalning.betalar === verifikat.id)
          .flatMap((betalning) => betalning.konteringar)
          .filter((post) => post.konto === konto)
          // A payment lowers a receivable (credit) or a payable (debit).
          .map((post) => (rad.slag === 'kund' ? negate(post.belopp) : post.belopp)),
      );
      return [
        {
          verifikat,
          slag: rad.slag,
          konto,
          belopp: rad.belopp,
          betalt,
          kvar: subtract(rad.belopp, betalt),
        },
      ];
    })
    .sort((a, b) =>
      a.verifikat.datum === b.verifikat.datum
        ? a.verifikat.nummer - b.verifikat.nummer
        : a.verifikat.datum < b.verifikat.datum
          ? -1
          : 1,
    );
}

/** The invoices with something left to pay. */
export function oppnaFakturor(alla: readonly BokfortVerifikat[]): Faktura[] {
  return fakturor(alla).filter((faktura) => faktura.kvar > ZERO);
}

export class FelBetalningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FelBetalningError';
  }
}

/**
 * The verifikat that settles all or part of an invoice.
 *
 * A customer pays into `betalkonto` and the receivable falls; the firm pays
 * a supplier out of it and the payable falls. More than what is left is
 * refused rather than turned into a credit balance on the other side.
 */
export function betalning(
  faktura: Faktura,
  uppgifter: {
    readonly id: Uuid;
    readonly datum: Datum;
    readonly belopp: Ore;
    readonly betalkonto: Kontonummer;
    readonly beteckning: string;
  },
): Verifikatutkast {
  if (uppgifter.belopp <= ZERO) {
    throw new FelBetalningError('Betalningen måste vara större än noll.');
  }
  if (uppgifter.belopp > faktura.kvar) {
    throw new FelBetalningError(
      'Betalningen är större än det som är kvar att betala på fakturan.',
    );
  }
  const kund = faktura.slag === 'kund';
  const utkast = skapaUtkast({
    id: uppgifter.id,
    datum: uppgifter.datum,
    beskrivning: `Betalning av ${uppgifter.beteckning}: ${faktura.verifikat.beskrivning}`,
    konteringar: kund
      ? [
          { konto: uppgifter.betalkonto, belopp: uppgifter.belopp },
          { konto: faktura.konto, belopp: negate(uppgifter.belopp) },
        ]
      : [
          { konto: faktura.konto, belopp: uppgifter.belopp },
          { konto: uppgifter.betalkonto, belopp: negate(uppgifter.belopp) },
        ],
    betalar: faktura.verifikat.id,
  });
  return utkast;
}
