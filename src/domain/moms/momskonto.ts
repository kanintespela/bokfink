import { kontonummer, type Kontonummer } from '../konto/konto';

/**
 * The moms account a booking most likely wants.
 *
 * BAS K1 2018, the chart for enskilda näringsidkare with a förenklat
 * årsbokslut: ingående moms is 2641 Debiterad ingående moms whatever the
 * rate, while utgående moms has one account per rate - 2611, 2621 and 2631
 * for sales within Sweden at 25, 12 and 6 % - because each rate is its own
 * box in the momsdeklaration (10, 11, 12). A suggestion only; every form
 * that uses it lets it be changed.
 */
export function forvaltMomskonto(
  riktning: 'utgift' | 'inkomst',
  momssats: number,
): Kontonummer | undefined {
  if (momssats === 0) {
    return undefined;
  }
  if (riktning === 'utgift') {
    return kontonummer('2641');
  }
  return kontonummer(momssats === 25 ? '2611' : momssats === 12 ? '2621' : '2631');
}
