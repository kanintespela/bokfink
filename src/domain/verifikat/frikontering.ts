import { add, negate, subtract, ZERO, type Ore } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import type { Kontonummer } from '../konto/konto';
import type { Kontering } from './verifikat';

/**
 * One row of a free posting, as the form holds it: an account and an amount
 * on one side. Everything may still be missing while it is being typed.
 */
export interface Friarad {
  readonly konto?: Kontonummer;
  readonly debet?: Ore;
  readonly kredit?: Ore;
  readonly text?: string;
  /** The project the row is booked on, if it is booked on one. */
  readonly projekt?: Uuid;
}

/**
 * The rows of a free posting as konteringar: debet positive, kredit negative.
 *
 * For what no template can book - a receipt with two VAT rates, a payment
 * of moms, a purchase of inventarier. The form asks for debet and kredit in
 * separate columns because that is how people who know bookkeeping write it,
 * and signed amounts are how the ledger stores it; this is the one place
 * the two meet. Whether the rows balance is not checked here but where every
 * verifikat is checked, in skapaUtkast (hard rule 4).
 *
 * A row with nothing on it is skipped, so the form can always offer a spare
 * one. A row half filled in is refused, by name.
 */
export function friaKonteringar(rader: readonly Friarad[]): Kontering[] {
  const konteringar: Kontering[] = [];
  rader.forEach((rad, index) => {
    const namn = `Rad ${index + 1}`;
    if (rad.konto === undefined && rad.debet === undefined && rad.kredit === undefined) {
      return;
    }
    if (rad.debet !== undefined && rad.kredit !== undefined) {
      throw new TypeError(`${namn} har både debet och kredit. Använd en rad för varje.`);
    }
    if (rad.konto === undefined) {
      throw new TypeError(`${namn} har ett belopp men saknar konto.`);
    }
    const belopp = rad.debet ?? rad.kredit;
    if (belopp === undefined) {
      throw new TypeError(`${namn} har konto ${rad.konto} men saknar belopp.`);
    }
    if (belopp <= 0) {
      throw new RangeError(
        `${namn}: beloppet måste vara större än noll. Ett belopp åt andra hållet skrivs ` +
          'i den andra kolumnen.',
      );
    }
    konteringar.push({
      konto: rad.konto,
      belopp: rad.debet !== undefined ? belopp : negate(belopp),
      ...(rad.text === undefined || rad.text.trim() === ''
        ? {}
        : { text: rad.text.trim() }),
      ...(rad.projekt === undefined ? {} : { projekt: rad.projekt }),
    });
  });
  return konteringar;
}

/** Both sides added up, and what separates them. Zero means it balances. */
export function summeraFriaRader(rader: readonly Friarad[]): {
  debet: Ore;
  kredit: Ore;
  skillnad: Ore;
} {
  const debet = rader.reduce((summa, rad) => add(summa, rad.debet ?? ZERO), ZERO);
  const kredit = rader.reduce((summa, rad) => add(summa, rad.kredit ?? ZERO), ZERO);
  return { debet, kredit, skillnad: subtract(debet, kredit) };
}
