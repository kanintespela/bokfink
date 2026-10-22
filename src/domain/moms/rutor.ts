import { kontoklass, type Kontonummer } from '../konto/konto';

/**
 * A box in the momsdeklaration.
 *
 * The numbers and headings are Skatteverket's own, taken from "Fylla i
 * momsdeklarationen". They are stable across years and are what the eSKD file
 * and the e-service both speak, so they are written out rather than derived.
 */
export interface Ruta {
  readonly nummer: number;
  readonly rubrik: string;
  readonly avsnitt: Avsnitt;
}

export type Avsnitt =
  | 'A. Momspliktig försäljning eller uttag exklusive moms'
  | 'B. Utgående moms på försäljning eller uttag i ruta 05–08'
  | 'C. Momspliktiga inköp där köparen är skattskyldig'
  | 'D. Utgående moms på inköp i ruta 20–24'
  | 'E. Försäljning m.m. som är undantagen från moms'
  | 'F. Import'
  | 'G. Utgående moms på import i ruta 50'
  | 'H. Ingående moms'
  | 'I. Moms att betala eller få tillbaka';

const A = 'A. Momspliktig försäljning eller uttag exklusive moms' as const;
const B = 'B. Utgående moms på försäljning eller uttag i ruta 05–08' as const;
const C = 'C. Momspliktiga inköp där köparen är skattskyldig' as const;
const D = 'D. Utgående moms på inköp i ruta 20–24' as const;
const E = 'E. Försäljning m.m. som är undantagen från moms' as const;
const F = 'F. Import' as const;
const G = 'G. Utgående moms på import i ruta 50' as const;
const H = 'H. Ingående moms' as const;
const I = 'I. Moms att betala eller få tillbaka' as const;

export const RUTOR: readonly Ruta[] = [
  {
    nummer: 5,
    rubrik: 'Momspliktig försäljning som inte ingår i ruta 06, 07 eller 08',
    avsnitt: A,
  },
  { nummer: 6, rubrik: 'Momspliktiga uttag', avsnitt: A },
  { nummer: 7, rubrik: 'Beskattningsunderlag vid vinstmarginalbeskattning', avsnitt: A },
  { nummer: 8, rubrik: 'Hyresinkomster vid frivillig skattskyldighet', avsnitt: A },

  { nummer: 10, rubrik: 'Utgående moms 25 %', avsnitt: B },
  { nummer: 11, rubrik: 'Utgående moms 12 %', avsnitt: B },
  { nummer: 12, rubrik: 'Utgående moms 6 %', avsnitt: B },

  { nummer: 20, rubrik: 'Inköp av varor från ett annat EU-land', avsnitt: C },
  {
    nummer: 21,
    rubrik: 'Inköp av tjänster från ett annat EU-land enligt huvudregeln',
    avsnitt: C,
  },
  { nummer: 22, rubrik: 'Inköp av tjänster från ett land utanför EU', avsnitt: C },
  { nummer: 23, rubrik: 'Inköp av varor i Sverige', avsnitt: C },
  { nummer: 24, rubrik: 'Övriga inköp av tjänster', avsnitt: C },

  { nummer: 30, rubrik: 'Utgående moms 25 %', avsnitt: D },
  { nummer: 31, rubrik: 'Utgående moms 12 %', avsnitt: D },
  { nummer: 32, rubrik: 'Utgående moms 6 %', avsnitt: D },

  { nummer: 35, rubrik: 'Försäljning av varor till ett annat EU-land', avsnitt: E },
  { nummer: 36, rubrik: 'Försäljning av varor utanför EU', avsnitt: E },
  { nummer: 37, rubrik: 'Mellanmans inköp av varor vid trepartshandel', avsnitt: E },
  {
    nummer: 38,
    rubrik: 'Mellanmans försäljning av varor vid trepartshandel',
    avsnitt: E,
  },
  {
    nummer: 39,
    rubrik:
      'Försäljning av tjänster till en näringsidkare i annat EU-land enligt huvudregeln',
    avsnitt: E,
  },
  { nummer: 40, rubrik: 'Övrig försäljning av tjänster omsatta utom landet', avsnitt: E },
  { nummer: 41, rubrik: 'Försäljning när köparen är skattskyldig i Sverige', avsnitt: E },
  { nummer: 42, rubrik: 'Övrig försäljning m.m.', avsnitt: E },

  { nummer: 50, rubrik: 'Beskattningsunderlag vid import', avsnitt: F },

  { nummer: 60, rubrik: 'Utgående moms 25 %', avsnitt: G },
  { nummer: 61, rubrik: 'Utgående moms 12 %', avsnitt: G },
  { nummer: 62, rubrik: 'Utgående moms 6 %', avsnitt: G },

  { nummer: 48, rubrik: 'Ingående moms att dra av', avsnitt: H },

  { nummer: 49, rubrik: 'Moms att betala eller få tillbaka', avsnitt: I },
];

export const RUTA = new Map(RUTOR.map((ruta) => [ruta.nummer, ruta]));

/**
 * Where an account's movement belongs in the declaration.
 *
 * `underlag` is a net amount and goes to a section A, C, E or F box.
 * `moms` is the tax itself and goes to a section B, D, G or H box.
 */
export interface Momsredovisning {
  readonly slag: 'underlag' | 'moms';
  readonly ruta: number;
}

/**
 * What each BAS account reports, by default.
 *
 * Derived from the account numbers BAS publishes and what they mean, so that
 * a ledger imported from a SIE file - which carries no VAT codes at all -
 * still produces a declaration. An account may override this; nothing here
 * is more than a starting point.
 *
 * Only accounts that actually reach the declaration are listed. Everything
 * else - the bank, equity, the cost accounts themselves - has nothing to say
 * to Skatteverket.
 */
const STANDARD: ReadonlyMap<string, Momsredovisning> = new Map([
  // B: utgående moms på egen försäljning.
  ['2610', { slag: 'moms', ruta: 10 }],
  ['2611', { slag: 'moms', ruta: 10 }],
  ['2612', { slag: 'moms', ruta: 10 }],
  ['2620', { slag: 'moms', ruta: 11 }],
  ['2621', { slag: 'moms', ruta: 11 }],
  ['2630', { slag: 'moms', ruta: 12 }],
  ['2631', { slag: 'moms', ruta: 12 }],

  // D: utgående moms på inköp där köparen är skattskyldig.
  ['2614', { slag: 'moms', ruta: 30 }],
  ['2617', { slag: 'moms', ruta: 30 }],
  ['2624', { slag: 'moms', ruta: 31 }],
  ['2634', { slag: 'moms', ruta: 32 }],

  // G: utgående moms på import.
  ['2615', { slag: 'moms', ruta: 60 }],
  ['2625', { slag: 'moms', ruta: 61 }],
  ['2635', { slag: 'moms', ruta: 62 }],

  // H: ingående moms, avdragsgill oavsett var den uppstod.
  ['2640', { slag: 'moms', ruta: 48 }],
  ['2641', { slag: 'moms', ruta: 48 }],
  ['2642', { slag: 'moms', ruta: 48 }],
  ['2645', { slag: 'moms', ruta: 48 }],
  ['2647', { slag: 'moms', ruta: 48 }],
  ['2644', { slag: 'moms', ruta: 48 }],

  // A: momspliktig försäljning inom Sverige.
  ['3010', { slag: 'underlag', ruta: 5 }],
  ['3011', { slag: 'underlag', ruta: 5 }],
  ['3041', { slag: 'underlag', ruta: 5 }],
  ['3042', { slag: 'underlag', ruta: 5 }],
  ['3043', { slag: 'underlag', ruta: 5 }],
  ['3051', { slag: 'underlag', ruta: 5 }],
  ['3052', { slag: 'underlag', ruta: 5 }],
  ['3053', { slag: 'underlag', ruta: 5 }],
  ['3061', { slag: 'underlag', ruta: 5 }],
  ['3062', { slag: 'underlag', ruta: 5 }],
  ['3063', { slag: 'underlag', ruta: 5 }],
  ['3913', { slag: 'underlag', ruta: 8 }],
  ['3224', { slag: 'underlag', ruta: 7 }],

  // E: försäljning undantagen från moms.
  ['3045', { slag: 'underlag', ruta: 40 }],
  ['3048', { slag: 'underlag', ruta: 39 }],
  ['3055', { slag: 'underlag', ruta: 36 }],
  ['3056', { slag: 'underlag', ruta: 35 }],
  ['3058', { slag: 'underlag', ruta: 35 }],
  ['3065', { slag: 'underlag', ruta: 35 }],
  ['3066', { slag: 'underlag', ruta: 36 }],
  ['3231', { slag: 'underlag', ruta: 41 }],

  // C: inköp där köparen är skattskyldig.
  ['4056', { slag: 'underlag', ruta: 20 }],
  ['4515', { slag: 'underlag', ruta: 20 }],
  ['4535', { slag: 'underlag', ruta: 21 }],
  ['4531', { slag: 'underlag', ruta: 22 }],
  ['4425', { slag: 'underlag', ruta: 24 }],

  // F: import.
  ['4545', { slag: 'underlag', ruta: 50 }],
]);

/**
 * What this account reports, if anything.
 *
 * Returns undefined for every account with nothing to say to Skatteverket,
 * which is most of them: the bank, equity, and the cost accounts whose VAT is
 * carried by a 26xx account beside them.
 */
export function standardredovisning(nummer: Kontonummer): Momsredovisning | undefined {
  const direkt = STANDARD.get(nummer);
  if (direkt !== undefined) {
    return direkt;
  }

  /*
   * Class 3 without a mapping of its own still reaches box 05 if it is a
   * sales account. 39xx are other income - grants, insurance, exchange gains
   * - which are not turnover and belong nowhere in the declaration.
   */
  if (kontoklass(nummer) === 3 && Number(nummer) < 3700) {
    return { slag: 'underlag', ruta: 5 };
  }

  return undefined;
}
