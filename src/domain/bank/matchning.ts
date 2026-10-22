import type { Ore } from '../belopp/ore';
import type { Kontonummer } from '../konto/konto';
import { dagarMellan } from '../tid/datum';
import type { BokfortVerifikat } from '../verifikat/verifikat';
import type { Banktransaktion } from './kontoutdrag';

/**
 * Matching a bank statement against what is already booked.
 *
 * The purpose is not to book anything - it is to answer "what have I
 * forgotten?" without producing the duplicate that the answer usually costs.
 * A statement holds a month of movements on the company account; most of them
 * are already in the books, and the few that are not are the work.
 */

/**
 * How many days apart a booking and a bank line may be.
 *
 * A card purchase is booked on the day of the receipt and reaches the account
 * a day or three later, over a weekend sometimes four. Wider than this and
 * two similar purchases in the same week start matching each other's lines.
 */
export const DAGARS_MARGINAL = 5;

export interface Matchning {
  readonly transaktion: Banktransaktion;
  /** The booking this line is already in, when it is in one. */
  readonly verifikat?: BokfortVerifikat;
}

/**
 * Pairs each statement line with the verifikat that already records it.
 *
 * A pair requires the same amount on the account the statement is for, and a
 * date within {@link DAGARS_MARGINAL}. The amount has to be exact: an almost
 * equal amount is a different purchase, and treating it as the same one hides
 * the very thing this is for.
 *
 * Each verifikat is used once. Two identical purchases in a week are two
 * lines and two bookings, and pairing both lines with the same booking would
 * report one of them as missing while it is not.
 */
export function matchaKontoutdrag(
  transaktioner: readonly Banktransaktion[],
  verifikat: readonly BokfortVerifikat[],
  konto: Kontonummer,
  dagarsMarginal: number = DAGARS_MARGINAL,
): Matchning[] {
  const kandidater = verifikat
    .map((post) => ({ post, belopp: beloppPaKonto(post, konto) }))
    .filter(
      (kandidat): kandidat is { post: BokfortVerifikat; belopp: Ore } =>
        kandidat.belopp !== undefined,
    );

  const anvanda = new Set<string>();

  return transaktioner.map((transaktion) => {
    const traff = basta(kandidater, transaktion, anvanda, dagarsMarginal);
    if (traff === undefined) {
      return { transaktion };
    }
    anvanda.add(traff.id);
    return { transaktion, verifikat: traff };
  });
}

/** The lines a statement has that the books do not. */
export function saknasIBokforingen(matchningar: readonly Matchning[]): Banktransaktion[] {
  return matchningar
    .filter((matchning) => matchning.verifikat === undefined)
    .map((matchning) => matchning.transaktion);
}

function basta(
  kandidater: readonly { post: BokfortVerifikat; belopp: Ore }[],
  transaktion: Banktransaktion,
  anvanda: ReadonlySet<string>,
  marginal: number,
): BokfortVerifikat | undefined {
  let basta: { post: BokfortVerifikat; avstand: number } | undefined;

  for (const kandidat of kandidater) {
    if (anvanda.has(kandidat.post.id) || kandidat.belopp !== transaktion.belopp) {
      continue;
    }
    const avstand = Math.abs(dagarMellan(kandidat.post.datum, transaktion.datum));
    if (avstand > marginal) {
      continue;
    }
    /*
     * The closest date wins, and an earlier booking wins a tie: a purchase is
     * booked from the receipt before the bank settles it, so the booking is
     * normally the earlier of the two.
     */
    if (
      basta === undefined ||
      avstand < basta.avstand ||
      (avstand === basta.avstand && kandidat.post.datum < basta.post.datum)
    ) {
      basta = { post: kandidat.post, avstand };
    }
  }

  return basta?.post;
}

/**
 * What a verifikat moved on one account.
 *
 * Summed rather than taken from the first row: a verifikat may touch the same
 * account twice, and only the net movement is what the bank saw.
 */
function beloppPaKonto(verifikat: BokfortVerifikat, konto: Kontonummer): Ore | undefined {
  let summa = 0;
  let funnen = false;
  for (const kontering of verifikat.konteringar) {
    if (kontering.konto === konto) {
      summa += kontering.belopp;
      funnen = true;
    }
  }
  return funnen ? (summa as Ore) : undefined;
}
