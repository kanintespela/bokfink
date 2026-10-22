import {
  add,
  delaOchAvrunda,
  formatKronor,
  isZero,
  negate,
  ore,
  subtract,
  type Ore,
} from '../belopp/ore';
import type { Beloppsangivelse } from '../moms/momskod';
import { kontonummer, type Kontonummer } from '../konto/konto';
import type { Uuid } from '../id/uuidv7';
import type { Kontering } from '../verifikat/verifikat';

/**
 * A ready-made way to book something that happens often.
 *
 * Measuring the books this was built for: the twelve most common account
 * combinations cover 61 % of all verifikat, and only 14 % are shapes that
 * occur once. A template is therefore the normal way to book rather than a
 * shortcut layered on top, and the entry flow is built around it - one
 * amount, one payment method, done.
 */
export interface Konteringsmall {
  readonly id: Uuid;
  readonly namn: string;
  /** Words that should find this template. Matched case- and accent-folded. */
  readonly sokord: readonly string[];
  readonly riktning: Riktning;
  /** Where the cost lands, or where the income comes from. */
  readonly konto: Kontonummer;
  /** Whole percent of the net: 25, 12, 6, or 0 for exempt. */
  readonly momssats: number;
  readonly momskonto?: Kontonummer;
  /**
   * Whether the amount typed in includes the VAT.
   *
   * A receipt states what was paid, so brutto is the default and what the
   * phone in a shop wants. An invoice states the net and adds the VAT, and
   * entering its gross figure produces a different split by an öre or two -
   * which is exactly where the öresutjämning lines in real books come from.
   */
  readonly angesSom?: Beloppsangivelse;
  /**
   * The amount, when it is always the same one.
   *
   * A subscription is booked twelve times a year for the identical figure,
   * and typing it out each time is twelve chances to type it wrong. Set, the
   * entry becomes: pick the template, check the date, done.
   */
  readonly standardbelopp?: Ore;
}

export type Riktning = 'utgift' | 'inkomst';

export const MOMSSATSER = [0, 6, 12, 25] as const;

/** BAS 3740, where a rounding difference of a few öre is booked. */
export const ORESUTJAMNING = kontonummer('3740');

export interface Beloppsdelar {
  /** What was actually paid or received, VAT included. */
  readonly brutto: Ore;
  readonly netto: Ore;
  readonly moms: Ore;
}

/**
 * Splits a gross amount into net and VAT.
 *
 * Hard rule 2: the rounding is explicit and named. VAT is worked out from the
 * gross with the fraction sats/(100+sats) and rounded to the nearest öre,
 * halves away from zero; the net is then the remainder rather than a second
 * rounded figure. Rounding both would let them fail to add up to what was
 * actually paid, which is the one thing that must never happen - the payment
 * line is the amount that left the account.
 *
 * The arithmetic stays in integers. Dividing in floating point and rounding
 * afterwards would put money through a float, which hard rule 1 forbids
 * regardless of whether a particular case happens to come out right.
 */
export function delaBelopp(brutto: Ore, momssats: number): Beloppsdelar {
  if (!Number.isInteger(momssats) || momssats < 0 || momssats > 100) {
    throw new RangeError(
      `Momssatsen måste vara ett heltal mellan 0 och 100 procent, fick ${momssats}.`,
    );
  }

  if (momssats === 0) {
    return { brutto, netto: brutto, moms: ore(0) };
  }

  const moms = delaOchAvrunda(brutto * momssats, 100 + momssats);
  return { brutto, netto: subtract(brutto, moms), moms };
}

/**
 * Splits an amount stated net of VAT.
 *
 * The tax is a straight percentage of what was typed, and the gross is their
 * sum, so an invoice reading 199 kr plus 25 % gives 49,75 and 248,75 -
 * exactly what such an invoice says, rather than the 199,20 and 49,80 that
 * treating 249 as the gross would produce.
 */
export function delaNetto(netto: Ore, momssats: number): Beloppsdelar {
  if (!Number.isInteger(momssats) || momssats < 0 || momssats > 100) {
    throw new RangeError(
      `Momssatsen måste vara ett heltal mellan 0 och 100 procent, fick ${momssats}.`,
    );
  }

  if (momssats === 0) {
    return { brutto: netto, netto, moms: ore(0) };
  }

  const moms = delaOchAvrunda(netto * momssats, 100);
  return { brutto: add(netto, moms), netto, moms };
}

/** Splits an amount the way the template says it is stated. */
/**
 * The split as it will be booked: computed from the template, then corrected
 * by what the underlag states, if it states anything.
 *
 * Exported so the form can show exactly the figures the posting will carry.
 * Two ways of arriving at the same numbers is how a screen and a verifikat
 * end up disagreeing.
 */
export function delaMedUnderlag(
  mall: Konteringsmall,
  belopp: Ore,
  angivenMoms?: Ore,
): Beloppsdelar {
  return medAngivenMoms(mall, delaEnligtMall(mall, belopp), angivenMoms);
}

export function delaEnligtMall(mall: Konteringsmall, belopp: Ore): Beloppsdelar {
  return mall.angesSom === 'netto'
    ? delaNetto(belopp, mall.momssats)
    : delaBelopp(belopp, mall.momssats);
}

/**
 * Turns a template and an amount into the lines of a verifikat.
 *
 * Hard rule 10: this produces a suggestion for a form, never a booking. The
 * amounts are what the arithmetic says; a receipt that rounded its VAT per
 * line will differ by an öre or two, and the person entering it corrects the
 * figure rather than the other way round.
 */
export function tillampaMall(
  mall: Konteringsmall,
  indata: {
    readonly brutto: Ore;
    readonly betalkonto: Kontonummer;
    /**
     * What actually left or reached the account, when it differs.
     *
     * A supplier who invoices 199 kr plus 25 % VAT states 49,75 and then
     * charges a round 249. The 25 öre between the two is real money and has
     * to be booked somewhere; leaving it out would make the entry disagree
     * with the bank.
     */
    readonly betalat?: Ore;
    /** Where the difference goes. BAS 3740 Öresutjämning by default. */
    readonly oreskonto?: Kontonummer;
    /**
     * The VAT the seller actually charged, when the underlag states it.
     *
     * A shop computes VAT per line and sums; Kontera computes it on the
     * total. Both are correct arithmetic and they differ by an öre or two
     * depending on where the rounding falls - a real receipt reads 1 004,00
     * with 200,81 of VAT, while 25 % of the total is 200,80.
     *
     * The receipt wins when it says. What may be deducted as ingående moms
     * is what the seller charged, and the verifikat should agree with the
     * underlag line for line, because that is what a granskare compares. The
     * net becomes the remainder rather than a second rounded figure, for the
     * same reason as in delaBelopp: the two have to add up to what was paid.
     */
    readonly moms?: Ore;
  },
): Kontering[] {
  const { brutto, netto, moms } = delaMedUnderlag(mall, indata.brutto, indata.moms);

  if (moms !== 0 && mall.momskonto === undefined) {
    throw new TypeError(
      `Mallen "${mall.namn}" har momssats ${mall.momssats} % men inget momskonto.`,
    );
  }

  const momsrad: Kontering[] =
    moms === 0 || mall.momskonto === undefined
      ? []
      : [
          {
            konto: mall.momskonto,
            belopp: mall.riktning === 'utgift' ? moms : negate(moms),
          },
        ];

  const betalat = indata.betalat ?? brutto;
  const oresdifferens = subtract(betalat, brutto);
  const oreskonto = indata.oreskonto ?? ORESUTJAMNING;

  /*
   * Öresutjämning is an income line whichever way the money went: paying a
   * little more than the invoice is a small cost, receiving a little more a
   * small gain, and BAS books both on 3740.
   */
  const oresrad: Kontering[] = isZero(oresdifferens)
    ? []
    : [
        {
          konto: oreskonto,
          belopp: mall.riktning === 'utgift' ? oresdifferens : negate(oresdifferens),
        },
      ];

  if (mall.riktning === 'utgift') {
    // Cost and input VAT are debited; the account that paid is credited.
    return [
      { konto: mall.konto, belopp: netto },
      ...momsrad,
      { konto: indata.betalkonto, belopp: negate(betalat) },
      ...oresrad,
    ];
  }

  // Income: the account that received is debited, income and output VAT credited.
  return [
    { konto: indata.betalkonto, belopp: betalat },
    { konto: mall.konto, belopp: negate(netto) },
    ...momsrad,
    ...oresrad,
  ];
}

/**
 * Ranks templates against what someone typed.
 *
 * Frequency comes from the caller, counted from the device's own event log.
 * That is the whole ranking - no model, no training, and nothing that would
 * need data to leave the device.
 */
export function sokMallar(
  mallar: readonly Konteringsmall[],
  fraga: string,
  anvandning: ReadonlyMap<Uuid, number> = new Map(),
): Konteringsmall[] {
  const sokt = normalisera(fraga);

  const traffar = mallar
    .map((mall) => ({ mall, poang: poangsatt(mall, sokt) }))
    .filter((post) => sokt.length === 0 || post.poang > 0);

  return traffar
    .sort((a, b) => {
      if (a.poang !== b.poang) {
        return b.poang - a.poang;
      }
      const anvandA = anvandning.get(a.mall.id) ?? 0;
      const anvandB = anvandning.get(b.mall.id) ?? 0;
      if (anvandA !== anvandB) {
        return anvandB - anvandA;
      }
      return a.mall.namn.localeCompare(b.mall.namn, 'sv');
    })
    .map((post) => post.mall);
}

function poangsatt(mall: Konteringsmall, sokt: string): number {
  if (sokt.length === 0) {
    return 0;
  }

  const namn = normalisera(mall.namn);
  if (namn === sokt) return 100;
  if (namn.startsWith(sokt)) return 80;
  if (namn.includes(sokt)) return 60;

  let basta = 0;
  for (const ord of mall.sokord) {
    const normaliserat = normalisera(ord);
    if (normaliserat === sokt) basta = Math.max(basta, 50);
    else if (normaliserat.startsWith(sokt)) basta = Math.max(basta, 40);
    else if (normaliserat.includes(sokt)) basta = Math.max(basta, 20);
  }
  return basta;
}

/**
 * Folds case and accents, so that searching "kop" finds "Köp".
 *
 * Typing å, ä or ö costs a keystroke on a phone keyboard, and someone in a
 * hurry will not spend it.
 */
function normalisera(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * Replaces the computed VAT with the one the underlag states.
 *
 * Refused rather than accepted quietly when it cannot be true: VAT larger
 * than the gross, or of the opposite sign, is a misread and would produce a
 * verifikat that balances but says something impossible. Hard rule 11.
 */
function medAngivenMoms(
  mall: Konteringsmall,
  beraknade: Beloppsdelar,
  angiven: Ore | undefined,
): Beloppsdelar {
  if (angiven === undefined || angiven === beraknade.moms) {
    return beraknade;
  }
  if (mall.momssats === 0 || mall.momskonto === undefined) {
    // A VAT-free template has no VAT to state, whatever the paper says.
    return beraknade;
  }
  if (angiven < 0 || angiven >= beraknade.brutto) {
    throw new RangeError(
      `Momsen ${formatKronor(angiven)} kan inte höra till beloppet ` +
        `${formatKronor(beraknade.brutto)}.`,
    );
  }

  return {
    brutto: beraknade.brutto,
    moms: angiven,
    netto: subtract(beraknade.brutto, angiven),
  };
}
