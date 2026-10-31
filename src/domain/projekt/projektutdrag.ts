import { add, negate, sum, ZERO, type Ore } from '../belopp/ore';
import { kontoklass, type Kontonummer } from '../konto/konto';
import { inomIntervall, jamfor, type Datum } from '../tid/datum';
import type { BokfortVerifikat } from '../verifikat/verifikat';
import type { Projekt } from './projekt';

/** The days a statement covers, ends included. */
export interface Projektperiod {
  readonly start: Datum;
  readonly slut: Datum;
}

/** One rad of the ledger that is booked on the project. */
export interface Projektrad {
  readonly datum: Datum;
  readonly verifikat: BokfortVerifikat;
  readonly konto: Kontonummer;
  /** The rad's own note if it has one, otherwise the verifikat's. */
  readonly text: string;
  /** As booked: debet positive, kredit negative. */
  readonly belopp: Ore;
}

/** What one account came to on the project, in the sign its group is read in. */
export interface Kontosumma {
  readonly konto: Kontonummer;
  readonly belopp: Ore;
}

/**
 * What the books say about one project: what came in, what it cost, and what
 * is left of it on the balance sheet.
 *
 * Every figure is read in the sign its group is read in - income and cost as
 * positive amounts, assets with the debit side positive, liabilities with the
 * credit side positive - so that a grant received and not yet used shows as
 * a positive skuld instead of a minus sign that gets misread.
 */
export interface Projektutdrag {
  readonly projekt: Projekt;
  /** Undefined for the whole of the project's life. */
  readonly period: Projektperiod | undefined;
  /** The project's rader in the period, in the order they happened. */
  readonly rader: readonly Projektrad[];
  /** Class 3. */
  readonly intakter: readonly Kontosumma[];
  readonly summaIntakter: Ore;
  /** Classes 4-7. */
  readonly kostnader: readonly Kontosumma[];
  readonly summaKostnader: Ore;
  /** Class 8, net: income positive, cost negative. */
  readonly finansiella: readonly Kontosumma[];
  readonly summaFinansiella: Ore;
  /** What the project came to: income less cost, financial items included. */
  readonly resultat: Ore;
  /** Class 1, up to the end of the period. */
  readonly tillgangar: readonly Kontosumma[];
  readonly summaTillgangar: Ore;
  /**
   * Class 2, up to the end of the period. A grant received for the project
   * and not yet taken up as income stands here, and what is left of it is
   * what is still to be used.
   */
  readonly skulder: readonly Kontosumma[];
  readonly summaSkulder: Ore;
}

/**
 * The statement of one project, from the verifikat booked on it.
 *
 * Result accounts count inside the period only; balance accounts count from
 * the beginning to the end of it, because a grant received in one year and
 * used in the next has to be followed across the turn. The opening balances of
 * a year carry no project and so add nothing, which is why a balance on a
 * project is the sum of its own rader and not a carried figure.
 *
 * A reversal carries the project of the verifikat it reverses, and so takes
 * its amounts out again.
 */
export function projektutdrag(
  projekt: Projekt,
  verifikat: Iterable<BokfortVerifikat>,
  period?: Projektperiod,
): Projektutdrag {
  const rader: Projektrad[] = [];
  for (const post of verifikat) {
    for (const rad of post.konteringar) {
      if (rad.projekt === projekt.id) {
        rader.push({
          datum: post.datum,
          verifikat: post,
          konto: rad.konto,
          text: rad.text ?? post.beskrivning,
          belopp: rad.belopp,
        });
      }
    }
  }
  rader.sort(
    (a, b) =>
      jamfor(a.datum, b.datum) ||
      a.verifikat.serie.localeCompare(b.verifikat.serie) ||
      a.verifikat.nummer - b.verifikat.nummer,
  );

  const iPerioden = rader.filter(
    (rad) => period === undefined || inomIntervall(rad.datum, period.start, period.slut),
  );
  const tillSlut = rader.filter(
    (rad) => period === undefined || rad.datum <= period.slut,
  );

  const summera = (underlag: readonly Projektrad[], klasser: (k: number) => boolean) => {
    const perKonto = new Map<Kontonummer, Ore>();
    for (const rad of underlag) {
      if (klasser(kontoklass(rad.konto))) {
        perKonto.set(rad.konto, add(perKonto.get(rad.konto) ?? ZERO, rad.belopp));
      }
    }
    return perKonto;
  };
  const lista = (perKonto: Map<Kontonummer, Ore>, tecken: 1 | -1): Kontosumma[] =>
    [...perKonto]
      .filter(([, belopp]) => belopp !== 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([konto, belopp]) => ({
        konto,
        belopp: tecken === 1 ? belopp : negate(belopp),
      }));
  const total = (poster: readonly Kontosumma[]) => sum(poster.map((post) => post.belopp));

  const intakter = lista(
    summera(iPerioden, (k) => k === 3),
    -1,
  );
  const kostnader = lista(
    summera(iPerioden, (k) => k >= 4 && k <= 7),
    1,
  );
  const finansiella = lista(
    summera(iPerioden, (k) => k === 8),
    -1,
  );
  const tillgangar = lista(
    summera(tillSlut, (k) => k === 1),
    1,
  );
  const skulder = lista(
    summera(tillSlut, (k) => k === 2),
    -1,
  );

  const summaIntakter = total(intakter);
  const summaKostnader = total(kostnader);
  const summaFinansiella = total(finansiella);

  return {
    projekt,
    period,
    rader: iPerioden,
    intakter,
    summaIntakter,
    kostnader,
    summaKostnader,
    finansiella,
    summaFinansiella,
    resultat: add(add(summaIntakter, negate(summaKostnader)), summaFinansiella),
    tillgangar,
    summaTillgangar: total(tillgangar),
    skulder,
    summaSkulder: total(skulder),
  };
}
