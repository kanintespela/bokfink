import { add, negate, ZERO, type Ore } from '../belopp/ore';
import { kontoklass, type Konto, type Kontonummer } from '../konto/konto';
import type { Rakenskapsar } from '../rakenskapsar/rakenskapsar';
import { datumAv, delar, sistaIManaden, type Datum } from '../tid/datum';
import type { BokfortVerifikat } from '../verifikat/verifikat';
import {
  kostnadsfordelning,
  likvidaMedel,
  likviditetPerManad,
  momsskuld,
  resultatPerManad,
  type Kostnadspost,
  type Manadsvarde,
} from './nyckeltal';
import { aretsResultat } from './resultatrakning';
import { beraknaPeriodsaldon, type Kontosaldo } from './saldon';

/**
 * The year on one page: the figures the Nyckeltal view shows, with last
 * year's beside them, and the series behind its three charts.
 *
 * Built from the same functions as the view, so the page that is printed or
 * sent on cannot say anything the screen did not.
 */
export interface Nyckeltalsoversikt {
  readonly ar: Rakenskapsar;
  /** The last day counted: today in a year still running, else the year's end. */
  readonly till: Datum;
  readonly iAr: Oversiktstal;
  /**
   * What is owed in moms as the ledger stands at `till`; negative is money
   * to come back. A position, not a movement, so it has no last-year figure.
   */
  readonly moms: Ore;
  /** The same stretch of the year before, when the books hold that year. */
  readonly ifjol?: {
    readonly ar: Rakenskapsar;
    readonly till: Datum;
    readonly tal: Oversiktstal;
  };
  /** Only the months that have begun by `till`. */
  readonly resultatPerManad: readonly Manadsvarde[];
  readonly likviditetPerManad: readonly Manadsvarde[];
  readonly kostnader: readonly Kostnadspost[];
}

export interface Oversiktstal {
  /** Class 3, positive. */
  readonly intakter: Ore;
  /** Classes 4 to 7, positive: what the business cost. */
  readonly kostnader: Ore;
  /** Class 8, signed as in a resultaträkning: interest earned is positive. */
  readonly finansiellaPoster: Ore;
  /** Intäkter less kostnader plus finansiella poster. */
  readonly resultat: Ore;
  /** In the bank and the till at the end of the period. */
  readonly likvida: Ore;
}

export function beraknaOversikt(
  ar: Rakenskapsar,
  allaAr: readonly Rakenskapsar[],
  verifikat: readonly BokfortVerifikat[],
  konton: ReadonlyMap<Kontonummer, Konto>,
  idag: Datum,
): Nyckeltalsoversikt {
  const till = idag < ar.slut ? idag : ar.slut;
  const saldon = beraknaPeriodsaldon(ar, verifikat, ar.start, till);
  const begunna = (varde: Manadsvarde) => varde.manad <= till.slice(0, 7);

  const fjolaret = allaAr
    .filter((kandidat) => kandidat.start < ar.start)
    .sort((a, b) => b.start.localeCompare(a.start))[0];
  const ifjol =
    fjolaret === undefined
      ? undefined
      : (() => {
          const fjolTill = sammaDagIFjol(till, ar, fjolaret);
          return {
            ar: fjolaret,
            till: fjolTill,
            tal: tal(beraknaPeriodsaldon(fjolaret, verifikat, fjolaret.start, fjolTill)),
          };
        })();

  return {
    ar,
    till,
    iAr: tal(saldon),
    moms: momsskuld(saldon),
    ...(ifjol === undefined ? {} : { ifjol }),
    resultatPerManad: resultatPerManad(ar, verifikat).filter(begunna),
    likviditetPerManad: likviditetPerManad(ar, verifikat).filter(begunna),
    kostnader: kostnadsfordelning(saldon, konton),
  };
}

/**
 * The day in last year that matches `till` in this one.
 *
 * Moved by as many years as the two years' starts lie apart, so a broken
 * fiscal year compares with its own months. The 29th of February becomes the
 * 28th in a year without it, and a day past last year's end is its end - a
 * shortened first year is compared in full.
 */
export function sammaDagIFjol(
  till: Datum,
  ar: Rakenskapsar,
  fjolaret: Rakenskapsar,
): Datum {
  const skillnad = delar(ar.start).ar - delar(fjolaret.start).ar;
  const { ar: artal, manad, dag } = delar(till);
  const manadsslut = delar(sistaIManaden(datumAv(artal - skillnad, manad, 1))).dag;
  const dagen = datumAv(artal - skillnad, manad, Math.min(dag, manadsslut));
  return dagen > fjolaret.slut ? fjolaret.slut : dagen;
}

function tal(saldon: ReadonlyMap<Kontonummer, Kontosaldo>): Oversiktstal {
  let intakter = ZERO;
  let kostnader = ZERO;
  let finansiellaPoster = ZERO;
  for (const saldo of saldon.values()) {
    const klass = kontoklass(saldo.konto);
    // Stored signs: income is credited (negative) and costs debited (positive).
    if (klass === 3) {
      intakter = add(intakter, negate(saldo.forandring));
    } else if (klass >= 4 && klass <= 7) {
      kostnader = add(kostnader, saldo.forandring);
    } else if (klass === 8) {
      finansiellaPoster = add(finansiellaPoster, negate(saldo.forandring));
    }
  }
  return {
    intakter,
    kostnader,
    finansiellaPoster,
    resultat: aretsResultat(saldon),
    likvida: likvidaMedel(saldon),
  };
}
