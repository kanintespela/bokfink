import { addDagar, datumAv, delar, type Datum } from '../tid/datum';
import type { Rakenskapsar } from '../rakenskapsar/rakenskapsar';

/**
 * The next räkenskapsår's span: twelve calendar months starting the day
 * after `ar` ends, whatever length `ar` itself was.
 *
 * A twelve-month year is the normal case regardless of what came before -
 * an eighteen-month first year (bokföringslagen 3 kap. 3 §, see
 * {@link skapaRakenskapsar}) exists precisely so every year after it can
 * fall on a clean calendar boundary, not so the odd length repeats. Counted
 * in calendar months rather than days, so a year ending 2026-12-31 is
 * followed by 2027-01-01–2027-12-31 exactly, not a boundary that drifts by a
 * day whenever a leap day falls inside it.
 */
export function nastaRakenskapsarsperiod(ar: Pick<Rakenskapsar, 'start' | 'slut'>): {
  readonly start: Datum;
  readonly slut: Datum;
} {
  const start = addDagar(ar.slut, 1);
  const { ar: startAr, manad, dag } = delar(start);
  const slut = addDagar(datumAv(startAr + 1, manad, dag), -1);
  return { start, slut };
}
