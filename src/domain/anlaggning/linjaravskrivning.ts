import { add, delaOchAvrunda, subtract, ZERO, type Ore } from '../belopp/ore';
import { ar } from '../tid/datum';
import type { Anlaggningstillgang } from './anlaggningstillgang';

/**
 * Straight-line depreciation of one inventarie, for an association.
 *
 * BFNAR 2010:1 punkt 6.34: machines and inventarier are written off over the
 * time the association means to use them, and the period may be set to five
 * years. Punkt 6.35: depreciation starts the year the asset is taken into use,
 * may be the same amount every year whether or not it was in use the whole
 * year, and need not be made the year the asset is sold or scrapped.
 *
 * Three choices are made here where the rule leaves them open, and each is the
 * simple one:
 *   - the asset is taken into use in the year it was acquired, since the
 *     register holds an acquisition date and nothing else;
 *   - the first year gets a full year's amount, which 6.35 allows;
 *   - nothing is written off in the year of a sale or scrapping, which it also
 *     allows, so the books never depreciate an asset that has already left.
 *
 * A firm's pool and kompletteringsregeln (avskrivning.ts) are the rules of
 * BFNAR 2006:1 and do not apply to an association.
 *
 * Years are counted as calendar years, which fits an association whose
 * räkenskapsår is the calendar year; a year that straddles two would need
 * the fiscal year of the acquisition date and not its calendar year.
 */
export function linjarAvskrivningForAr(tillgang: Anlaggningstillgang, aret: number): Ore {
  const forstaAr = ar(tillgang.anskaffningsdatum);
  const sistaAr = forstaAr + tillgang.nyttjandeperiod - 1;

  if (aret < forstaAr || aret > sistaAr) {
    return ZERO;
  }
  if (tillgang.avyttring !== undefined && aret >= ar(tillgang.avyttring.datum)) {
    return ZERO;
  }

  const innehavsar = aret - forstaAr + 1;
  return subtract(
    ackumulerat(tillgang, innehavsar),
    ackumulerat(tillgang, innehavsar - 1),
  );
}

/**
 * What has been written off after the given number of years: the acquisition
 * value times years over the period, rounded to the nearest öre with halves
 * away from zero (delaOchAvrunda).
 *
 * A year's amount is the difference between two such totals, so the amounts add
 * up to the acquisition value to the öre however it divides, none is negative,
 * and no two years differ by more than an öre. Rounding each year on its own and
 * giving the last one the remainder can leave a negative last year for a small
 * amount over many years.
 */
function ackumulerat(tillgang: Anlaggningstillgang, aretsInnehav: number): Ore {
  return delaOchAvrunda(
    tillgang.anskaffningsvarde * aretsInnehav,
    tillgang.nyttjandeperiod,
  );
}

export interface Linjarrad {
  readonly tillgang: Anlaggningstillgang;
  readonly belopp: Ore;
}

/** The year's depreciation for each asset that has any, and what they come to. */
export function linjaraAvskrivningar(
  tillgangar: readonly Anlaggningstillgang[],
  aret: number,
): { readonly rader: readonly Linjarrad[]; readonly summa: Ore } {
  const rader = tillgangar
    .map((tillgang) => ({ tillgang, belopp: linjarAvskrivningForAr(tillgang, aret) }))
    .filter((rad) => rad.belopp !== ZERO);
  return { rader, summa: rader.reduce((summa, rad) => add(summa, rad.belopp), ZERO) };
}
