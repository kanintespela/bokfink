import { datumAv, type Datum } from '../tid/datum';
import { fristdag } from '../tid/helgdag';

/**
 * The last day the inkomstdeklaration for a beskattningsår may reach
 * Skatteverket, NE-bilagan included.
 *
 * Skatteförfarandelagen (2011:1244) 32 kap. 1 §: "Fysiska personer och
 * dödsbon ska lämna inkomstdeklaration senast den 2 maj året efter utgången
 * av beskattningsåret." An enskild firma is its owner, a fysisk person. A day
 * that is not a vardag moves to the next one, lag (1930:173) 2 §.
 *
 * Extended dates through an ombud or a granted anstånd are left out: they are
 * decisions about one person, not rules Kontera can know.
 */
export function sistaDagForInkomstdeklaration(beskattningsar: number): Datum {
  return fristdag(datumAv(beskattningsar + 1, 5, 2));
}
