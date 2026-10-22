import { add, sum, type Ore } from '../belopp/ore';
import type { Kontonummer } from '../konto/konto';
import { jamfor, type Datum } from '../tid/datum';
import type { BokfortVerifikat } from '../verifikat/verifikat';

export interface Utdragsrad {
  readonly datum: Datum;
  readonly verifikat: BokfortVerifikat;
  /** The line's own note if it has one, otherwise the verifikat's. */
  readonly text: string;
  readonly belopp: Ore;
  /** The account's balance once this line has been applied. */
  readonly saldo: Ore;
}

export interface Kontoutdrag {
  readonly konto: Kontonummer;
  readonly ingaende: Ore;
  readonly rader: readonly Utdragsrad[];
  readonly utgaende: Ore;
  readonly in: Ore;
  readonly ut: Ore;
}

/**
 * Every movement on one account, in the order it happened, with the balance
 * carried along.
 *
 * This is what answers "what came in and what went out" - a different
 * question from "what did I book", which the verifikationslista answers. Both
 * are needed: one is checked against a bank statement, the other against a
 * pile of receipts.
 *
 * A verifikat may touch the same account more than once, as the real books
 * do when two depreciations are booked together, so each line is a row of
 * its own rather than being summed away.
 */
export function kontoutdrag(
  konto: Kontonummer,
  ingaende: Ore,
  verifikat: Iterable<BokfortVerifikat>,
): Kontoutdrag {
  const iOrdning = [...verifikat].sort(efterDatumOchNummer);

  const rader: Utdragsrad[] = [];
  let saldo = ingaende;

  for (const post of iOrdning) {
    for (const rad of post.konteringar) {
      if (rad.konto !== konto) {
        continue;
      }
      saldo = add(saldo, rad.belopp);
      rader.push({
        datum: post.datum,
        verifikat: post,
        text: rad.text ?? post.beskrivning,
        belopp: rad.belopp,
        saldo,
      });
    }
  }

  const belopp = rader.map((rad) => rad.belopp);
  return {
    konto,
    ingaende,
    rader,
    utgaende: saldo,
    in: sum(belopp.filter((v) => v > 0)),
    ut: sum(belopp.filter((v) => v < 0)),
  };
}

/**
 * Date first, then the number, so two entries on the same day always come out
 * in the same order however the list was fetched.
 */
function efterDatumOchNummer(a: BokfortVerifikat, b: BokfortVerifikat): number {
  const datum = jamfor(a.datum, b.datum);
  if (datum !== 0) {
    return datum;
  }
  return a.serie === b.serie ? a.nummer - b.nummer : a.serie.localeCompare(b.serie);
}

/** Which accounts a set of verifikat actually touched. */
export function beroradaKonton(verifikat: Iterable<BokfortVerifikat>): Set<Kontonummer> {
  const konton = new Set<Kontonummer>();
  for (const post of verifikat) {
    for (const rad of post.konteringar) {
      konton.add(rad.konto);
    }
  }
  return konton;
}
