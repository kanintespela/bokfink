import { add, ZERO, type Ore } from '../belopp/ore';
import { arBalanskonto, harledKontotyp, type Kontonummer } from '../konto/konto';
import type { Ingaendebalans, Rakenskapsar } from '../rakenskapsar/rakenskapsar';
import { inomIntervall, type Datum } from '../tid/datum';
import type { BokfortVerifikat } from '../verifikat/verifikat';

export interface Kontosaldo {
  readonly konto: Kontonummer;
  /** What the account brought into the year. Always zero for result accounts. */
  readonly ingaende: Ore;
  /** What the year's verifikat moved. */
  readonly forandring: Ore;
  readonly utgaende: Ore;
}

/**
 * Adds up a year: what each account started at, what moved, and where it
 * ended.
 *
 * This is what a huvudbok, a balansräkning and a resultaträkning are all
 * built on, and what a SIE export writes as #UB and #RES. Doing it once means
 * the export cannot disagree with the report.
 *
 * A result account has no opening balance by definition, so its closing
 * figure is simply the year's movement - which is exactly what SIE's #RES
 * carries.
 */
export function beraknaSaldon(
  ingaende: readonly Ingaendebalans[],
  verifikat: Iterable<BokfortVerifikat>,
): Map<Kontonummer, Kontosaldo> {
  const start = new Map<Kontonummer, Ore>();
  for (const post of ingaende) {
    start.set(post.konto, add(start.get(post.konto) ?? ZERO, post.belopp));
  }

  const rorelse = new Map<Kontonummer, Ore>();
  for (const post of verifikat) {
    for (const rad of post.konteringar) {
      rorelse.set(rad.konto, add(rorelse.get(rad.konto) ?? ZERO, rad.belopp));
    }
  }

  const saldon = new Map<Kontonummer, Kontosaldo>();
  for (const konto of new Set([...start.keys(), ...rorelse.keys()])) {
    const ib = start.get(konto) ?? ZERO;
    const forandring = rorelse.get(konto) ?? ZERO;
    saldon.set(konto, { konto, ingaende: ib, forandring, utgaende: add(ib, forandring) });
  }

  return saldon;
}

/** Closing balances for the accounts that carry one across the year end. */
export function utgaendeBalanser(
  saldon: ReadonlyMap<Kontonummer, Kontosaldo>,
): Kontosaldo[] {
  return [...saldon.values()].filter(arBalans).sort(efterKonto);
}

/** The year's movement on the accounts that close into the result. */
export function aretsResultatposter(
  saldon: ReadonlyMap<Kontonummer, Kontosaldo>,
): Kontosaldo[] {
  return [...saldon.values()].filter((saldo) => !arBalans(saldo)).sort(efterKonto);
}

function arBalans(saldo: Kontosaldo): boolean {
  const typ = harledKontotyp(saldo.konto);
  // Class 8 cannot be derived from the number, but every account in it closes
  // into the result, which is the only thing this distinction needs.
  return typ !== undefined && arBalanskonto(typ);
}

function efterKonto(a: Kontosaldo, b: Kontosaldo): number {
  return a.konto.localeCompare(b.konto);
}

/**
 * The same sums, for a period inside the year rather than the whole of it.
 *
 * `ingaende` becomes what the account had reached when the period opened -
 * the year's opening balance plus everything booked in the year before it -
 * and `forandring` is what the period itself moved. That gives both reports
 * from one structure: a balansräkning reads the closing figure at the end of
 * the period, and a resultaträkning reads the movement within it.
 *
 * A result account carries no balance across a year end, so its opening
 * figure here is what the year had accumulated before the period. That is not
 * a balance in the bookkeeping sense; it is what "so far this year" means,
 * and it is the number a comparison against last quarter needs.
 *
 * The year is passed rather than only its opening balances, so that verifikat
 * from earlier years are left out here and not by every caller. The opening
 * balance is those years, summed; counting them again put a loan paid off in
 * 2023 back into the balance sheet of every year after it.
 */
export function beraknaPeriodsaldon(
  ar: Pick<Rakenskapsar, 'start' | 'ingaendeBalanser'>,
  verifikat: Iterable<BokfortVerifikat>,
  fran: Datum,
  till: Datum,
): Map<Kontonummer, Kontosaldo> {
  const fore: BokfortVerifikat[] = [];
  const inom: BokfortVerifikat[] = [];

  for (const post of verifikat) {
    if (post.datum < ar.start) {
      // An earlier year, already inside the opening balance.
      continue;
    }
    if (post.datum < fran) {
      fore.push(post);
    } else if (inomIntervall(post.datum, fran, till)) {
      inom.push(post);
    }
    // Anything after the period belongs to a later report.
  }

  const vidIngangen = beraknaSaldon(ar.ingaendeBalanser, fore);
  const rorelse = beraknaSaldon([], inom);

  const saldon = new Map<Kontonummer, Kontosaldo>();
  for (const konto of new Set([...vidIngangen.keys(), ...rorelse.keys()])) {
    const ib = vidIngangen.get(konto)?.utgaende ?? ZERO;
    const forandring = rorelse.get(konto)?.forandring ?? ZERO;
    saldon.set(konto, { konto, ingaende: ib, forandring, utgaende: add(ib, forandring) });
  }

  return saldon;
}
