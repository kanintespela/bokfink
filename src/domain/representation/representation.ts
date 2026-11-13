import { delaOchAvrunda, negate, ore, subtract, type Ore } from '../belopp/ore';
import { kontonummer, type Kontonummer } from '../konto/konto';
import type { Kontering } from '../verifikat/verifikat';

/**
 * Representation: what may be deducted from the moms and from the income, which
 * are two different questions with different limits.
 *
 * Sources, all Skatteverket (the pages carry no date and cite no paragraphs of
 * mervärdesskattelagen, so neither is cited here):
 *
 *  - Moms: "Avdrag för moms vid representation",
 *    https://www.skatteverket.se/foretag/moms/kopavarorochtjanster/avdragformomsvidrepresentation.4.15532c7b1442f256baec84b.html
 *    Moms is deductible on a base of at most 300 kr excluding moms per person
 *    and occasion, for food and drink, and on a gift at most 300 kr per person.
 *    A cost above that is split in proportion: the moms is scaled by
 *    300 kr x persons / the cost excluding moms. The page's own example (three
 *    persons, food 900 kr and beer 600 kr excluding moms, moms 258 kr) gives
 *    258 x 900 / 1 500 = 154,80 kr.
 *  - Income tax: "Avdragslexikon för företag", Representation,
 *    https://www.skatteverket.se/foretag/skatterochavdrag/avdragforforetag/avdragslexikonforetag.4.3684199413c956649b550c8.html
 *    A meal (frukost, lunch, middag) is deductible at 0 kr. Enklare förtäring
 *    is deductible up to 60 kr per person excluding moms, and above that "inte
 *    ... avdrag med något belopp alls". A representation or advertising gift is
 *    deductible at a reasonable amount, at most 300 kr excluding moms.
 *
 * The schablon alternative for moms (46 kr, or 33 kr at 6 % moms, per person)
 * is not implemented: the page gives different figures in different places, and
 * the proportional rule above is the one it works through.
 *
 * Booked on BAS 6071 (deductible) and 6072 (not deductible), with the
 * deductible moms on 2641. 6072 is added back on the NE-bilaga (R13).
 */

export const REPRESENTATIONSTYP = {
  maltid: { namn: 'Måltid, till exempel lunch eller middag', enhet: 'personer' },
  enklare: { namn: 'Enklare förtäring, till exempel fika', enhet: 'personer' },
  gava: { namn: 'Gåva till kund', enhet: 'gåvor' },
} as const;
export type Representationstyp = keyof typeof REPRESENTATIONSTYP;

/** 300 kr in öre: the base moms may be deducted on, per person or per gift. */
const MOMSUNDERLAG_PER_PERSON = ore(30_000);
/** 60 kr in öre, excluding moms, per person for enklare förtäring. */
const FORTARING_PER_PERSON = ore(6_000);

export interface Representationsindata {
  readonly typ: Representationstyp;
  /** What was paid, moms included. */
  readonly brutto: Ore;
  /** The moms the receipt states. */
  readonly moms: Ore;
  /** The people present, or the gifts given. */
  readonly antal: number;
  readonly betalkonto: Kontonummer;
}

export interface Representationsfordelning {
  readonly konteringar: Kontering[];
  /** Moms that may be deducted, on 2641. */
  readonly avdragsgillMoms: Ore;
  /** Cost deductible at the income tax, on 6071. */
  readonly avdragsgillKostnad: Ore;
  /** Cost that is not, on 6072. */
  readonly ejAvdragsgillKostnad: Ore;
}

/**
 * How the amount is divided between the moms deduction and the two cost
 * accounts. Always adds up to what was paid.
 */
export function fordelaRepresentation(
  indata: Representationsindata,
): Representationsfordelning {
  const { typ, brutto, moms, antal, betalkonto } = indata;
  if (REPRESENTATIONSTYP[typ] === undefined) {
    throw new TypeError('Välj vilken sorts representation det är.');
  }
  if (!Number.isInteger(antal) || antal < 1) {
    throw new TypeError(
      typ === 'gava' ? 'Ange hur många gåvor det är.' : 'Ange hur många som var med.',
    );
  }
  if (brutto <= 0) {
    throw new TypeError('Beloppet måste vara större än noll.');
  }
  if (moms < 0 || moms >= brutto) {
    throw new TypeError(
      'Momsen måste vara mindre än beloppet du betalat, och inte negativ.',
    );
  }
  if (!['1930', '2013', '1910'].includes(betalkonto)) {
    throw new TypeError('Välj ett betalkonto.');
  }

  const netto = subtract(brutto, moms);
  const underlagsgrans = ore(MOMSUNDERLAG_PER_PERSON * antal);

  // Whole moms up to the limit, otherwise in proportion. Halves round away from
  // zero at an öre, as in delaOchAvrunda.
  const avdragsgillMoms =
    netto <= underlagsgrans ? moms : delaOchAvrunda(moms * underlagsgrans, netto);

  let avdragsgillKostnad: Ore;
  if (typ === 'maltid') {
    avdragsgillKostnad = ore(0);
  } else if (typ === 'enklare') {
    avdragsgillKostnad =
      netto <= FORTARING_PER_PERSON * antal ? subtract(brutto, avdragsgillMoms) : ore(0);
  } else {
    avdragsgillKostnad = netto <= underlagsgrans ? netto : underlagsgrans;
  }
  const ejAvdragsgillKostnad = subtract(
    subtract(brutto, avdragsgillMoms),
    avdragsgillKostnad,
  );

  const rad = (konto: string, belopp: Ore): Kontering[] =>
    belopp === 0 ? [] : [{ konto: kontonummer(konto), belopp }];
  return {
    konteringar: [
      ...rad('6071', avdragsgillKostnad),
      ...rad('6072', ejAvdragsgillKostnad),
      ...rad('2641', avdragsgillMoms),
      { konto: betalkonto, belopp: negate(brutto) },
    ],
    avdragsgillMoms,
    avdragsgillKostnad,
    ejAvdragsgillKostnad,
  };
}
