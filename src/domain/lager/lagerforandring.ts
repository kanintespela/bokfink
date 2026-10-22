import { isZero, negate, subtract, type Ore } from '../belopp/ore';
import { kontonummer, type Kontonummer } from '../konto/konto';
import type { Kontering } from '../verifikat/verifikat';

/** BAS 1400 Lager, where the owner's books keep the djurlager. */
export const LAGERKONTO = kontonummer('1400');

/** BAS K1 2018 4900 Förändring av lager, where the year's change in stock meets the result. */
export const LAGERFORANDRINGSKONTO = kontonummer('4900');

/**
 * The rows that bring the stock account to the counted value.
 *
 * BFNAR 2006:1 punkt 7.7 d: the year's cost includes the difference in the
 * varulager's value at the start and the end of the year, and the value is
 * the one counted on the balansdag (punkt 6.45-6.55; for djur i jordbruk,
 * IL 17 kap. 5 §). Purchases and sales are booked as cost and income during
 * the year; this one entry, made once, is where the stock itself moves. A
 * rise is more stock and less cost, a fall the other way.
 *
 * Undefined when the account already holds the counted value.
 */
export function lagerforandringskonteringar(
  inventerat: Ore,
  bokfort: Ore,
  lagerkonto: Kontonummer = LAGERKONTO,
  forandringskonto: Kontonummer = LAGERFORANDRINGSKONTO,
): readonly [Kontering, Kontering] | undefined {
  const skillnad = subtract(inventerat, bokfort);
  if (isZero(skillnad)) {
    return undefined;
  }
  return skillnad > 0
    ? [
        { konto: lagerkonto, belopp: skillnad },
        { konto: forandringskonto, belopp: negate(skillnad) },
      ]
    : [
        { konto: forandringskonto, belopp: negate(skillnad) },
        { konto: lagerkonto, belopp: skillnad },
      ];
}
