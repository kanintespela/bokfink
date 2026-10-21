import { ore, type Ore } from './ore';

/**
 * Amounts in a currency that is not the one the books are kept in.
 *
 * Bokföringslagen (1999:1078) 4 kap. 6 §: the affärshändelser are recorded in
 * the company's redovisningsvaluta, which for an enskild firma is svenska
 * kronor. A receipt in euro is therefore converted on the way in, and the
 * rate that was used is recorded - because in a year nobody remembers it, and
 * a figure nobody can reproduce is not räkenskapsinformation.
 *
 * Which rate is the right one is a question for whoever books it. It differs
 * between a card purchase (the bank's own rate, printed on the statement) and
 * the beskattningsunderlag for an EU purchase (a published rate for the day).
 * Kontera records what it was told; it does not decide.
 */

/** An ISO 4217 code, three uppercase letters. */
export type Valutakod = string & { readonly __brand: 'Valutakod' };

export function valutakod(text: string): Valutakod {
  const rensad = text.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(rensad)) {
    throw new TypeError(
      `"${text}" är ingen valutakod. Den ska vara tre bokstäver, som EUR eller USD.`,
    );
  }
  return rensad as Valutakod;
}

/**
 * How many decimals a rate is kept with.
 *
 * Rates are quoted with four to six: 11,4523 kronor to the euro, and more for
 * a currency where one krona buys thousands. Six covers both and is exact,
 * because the rate is an integer count of millionths rather than a float -
 * hard rule 1 applies to the multiplier as much as to the amount.
 */
export const KURS_DECIMALER = 6;
const KURS_SKALA = 10n ** BigInt(KURS_DECIMALER);

/** A rate as an integer number of millionths of the accounting currency. */
export type Kurs = number & { readonly __brand: 'Kurs' };

/** Optional sign is deliberately absent: a negative rate is not a rate. */
const KURSTEXT = /^(\d+)(?:[.,](\d{1,6}))?$/;

/**
 * Reads a rate as it is written: 11,4523 kronor per unit.
 *
 * Parsed digit by digit rather than through parseFloat, so the rate never
 * exists as a binary fraction. 11,4523 is not representable in a float, and
 * the error it carries would land in an amount of money.
 */
export function kurs(text: string): Kurs {
  const match = KURSTEXT.exec(text.trim());
  if (!match) {
    throw new TypeError(
      `"${text}" är ingen växelkurs. Skriv den som antal kronor per enhet, till ` +
        'exempel 11,4523.',
    );
  }

  const heltal = match[1] ?? '0';
  const decimaler = (match[2] ?? '').padEnd(KURS_DECIMALER, '0');
  const varde = Number(`${heltal}${decimaler}`);

  if (!Number.isSafeInteger(varde) || varde <= 0) {
    throw new RangeError(`Växelkursen "${text}" ligger utanför det rimliga.`);
  }
  return varde as Kurs;
}

/** The rate as it is written back out, without trailing zeroes. */
export function kursText(varde: Kurs): string {
  const heltal = Math.trunc(varde / Number(KURS_SKALA));
  const decimaler = String(varde % Number(KURS_SKALA))
    .padStart(KURS_DECIMALER, '0')
    .replace(/0+$/, '');
  return decimaler.length === 0 ? String(heltal) : `${heltal},${decimaler}`;
}

/**
 * Converts an amount in a foreign currency to the accounting currency.
 *
 * Hard rule 2: the rounding is named and it is to the nearest öre, halves
 * away from zero - the same rule VAT splitting uses, so that two ways of
 * arriving at the same figure agree.
 *
 * The multiplication is done in BigInt. An amount in minor units times a rate
 * in millionths passes 2^53 for sums that are entirely ordinary in a currency
 * like yen, and a product that silently loses its last digits is exactly the
 * kind of error hard rule 1 exists to prevent.
 */
export function tillRedovisningsvaluta(belopp: Ore, vaxelkurs: Kurs): Ore {
  const produkt = BigInt(belopp) * BigInt(vaxelkurs);
  const tecken = produkt < 0n ? -1n : 1n;
  const absolut = produkt * tecken;

  // Halves away from zero: add half the divisor before truncating.
  const avrundad = (absolut + KURS_SKALA / 2n) / KURS_SKALA;
  return ore(Number(avrundad * tecken));
}

/**
 * The rate implied by a known pair of amounts.
 *
 * A card statement gives both sides - 49,00 EUR became 561,20 SEK - and the
 * rate is what the bank actually charged, fees and all. Reading it off is
 * more honest than looking up a published rate that was not the one used.
 */
export function kursAv(belopp: Ore, iRedovisningsvaluta: Ore): Kurs {
  if (belopp === 0) {
    throw new RangeError('Det går inte att räkna ut en kurs ur beloppet noll.');
  }
  const produkt = BigInt(iRedovisningsvaluta) * KURS_SKALA;
  const namnare = BigInt(belopp);
  const tecken = produkt * namnare < 0n ? -1n : 1n;
  const absolut =
    (produkt * (produkt < 0n ? -1n : 1n)) / (namnare * (namnare < 0n ? -1n : 1n));

  const varde = Number(absolut) * Number(tecken);
  if (!Number.isSafeInteger(varde) || varde <= 0) {
    throw new RangeError(
      'Kursen mellan de beloppen går inte att uttrycka som en växelkurs.',
    );
  }
  return varde as Kurs;
}

/**
 * The difference between what a claim was booked at and what it was worth
 * when it was settled.
 *
 * Positive is a gain: more kronor came in, or fewer went out, than the books
 * said. Only arises under the faktureringsmetod, where an invoice is recorded
 * at one date and paid at another - under the kontantmetoden the two are the
 * same moment and the difference is always zero.
 */
export function kursdifferens(bokfort: Ore, betalt: Ore): Ore {
  return ore(betalt - bokfort);
}
