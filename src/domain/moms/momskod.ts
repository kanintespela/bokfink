import type { Kontonummer } from '../konto/konto';
import { kontonummer } from '../konto/konto';

/**
 * How an amount is entered.
 *
 * A receipt states what was paid; an invoice usually states the net and adds
 * the VAT. Getting this wrong by a krona is how the öresutjämning lines in
 * real books come about: an invoice of 199 kr plus VAT is 248,75, and the
 * payment of 249 leaves 25 öre that has to go somewhere.
 */
export type Beloppsangivelse = 'brutto' | 'netto';

/**
 * A VAT code: the rate, where the tax is booked, and what it means to the
 * declaration.
 *
 * Kept separate from the template so that the same code can be shared by
 * several templates and, later, be attached to an account.
 */
export interface Momskod {
  readonly kod: string;
  readonly namn: string;
  /** Whole percent of the net: 25, 12, 6, or 0. */
  readonly sats: number;
  readonly riktning: 'utgaende' | 'ingaende';
  /** Where the tax itself is booked. Absent for an exempt code. */
  readonly momskonto?: Kontonummer;
  /**
   * Reverse charge: the buyer accounts for the VAT.
   *
   * The same amount is booked as output VAT owed and as input VAT deducted,
   * so nothing is paid but both sides appear in the declaration.
   */
  readonly omvandSkattskyldighet?: {
    readonly utgaendekonto: Kontonummer;
    readonly ingaendekonto: Kontonummer;
  };
}

/**
 * The codes a Swedish sole trader meets.
 *
 * Rates from mervärdesskattelagen (2023:200) 8 kap.: 25 % as the general
 * rate, 12 % for food and some others, 6 % for books, transport of persons
 * and cultural events.
 */
export const MOMSKODER: readonly Momskod[] = [
  {
    kod: 'UTG25',
    namn: 'Försäljning 25 %',
    sats: 25,
    riktning: 'utgaende',
    momskonto: kontonummer('2610'),
  },
  {
    kod: 'UTG12',
    namn: 'Försäljning 12 %',
    sats: 12,
    riktning: 'utgaende',
    momskonto: kontonummer('2620'),
  },
  {
    kod: 'UTG06',
    namn: 'Försäljning 6 %',
    sats: 6,
    riktning: 'utgaende',
    momskonto: kontonummer('2630'),
  },
  { kod: 'UTG00', namn: 'Försäljning utan moms', sats: 0, riktning: 'utgaende' },

  {
    kod: 'ING25',
    namn: 'Inköp 25 %',
    sats: 25,
    riktning: 'ingaende',
    momskonto: kontonummer('2640'),
  },
  {
    kod: 'ING12',
    namn: 'Inköp 12 %',
    sats: 12,
    riktning: 'ingaende',
    momskonto: kontonummer('2640'),
  },
  {
    kod: 'ING06',
    namn: 'Inköp 6 %',
    sats: 6,
    riktning: 'ingaende',
    momskonto: kontonummer('2640'),
  },
  { kod: 'ING00', namn: 'Inköp utan moms', sats: 0, riktning: 'ingaende' },

  {
    kod: 'OMV25',
    namn: 'Inköp med omvänd skattskyldighet 25 %',
    sats: 25,
    riktning: 'ingaende',
    omvandSkattskyldighet: {
      utgaendekonto: kontonummer('2614'),
      ingaendekonto: kontonummer('2645'),
    },
  },
];

export const MOMSKOD = new Map(MOMSKODER.map((kod) => [kod.kod, kod]));
