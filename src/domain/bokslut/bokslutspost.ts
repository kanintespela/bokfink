import { negate, oreFromKronor, type Ore } from '../belopp/ore';
import { kontonummer, type Kontonummer } from '../konto/konto';
import { delaBelopp } from '../mall/konteringsmall';
import { forvaltMomskonto } from '../moms/momskonto';
import type { Kontering } from '../verifikat/verifikat';

/**
 * What a förenklat årsbokslut takes up at the year's end, beyond the
 * bokföring made when money moved.
 *
 * K1 is built on cash: income and cost are what was received and paid. At
 * the year's end a closed list of items is added (BFNAR 2006:1), and nothing
 * else - this is that list, and there is deliberately no general "förutbetald
 * kostnad split by days". The owner's decision of 2026-09-13 was to follow
 * K1's list and have every item reversed on the first day of the next year,
 * where it is paid, received or delivered.
 *
 * The accounts are BAS K1 2018's: 1500 Kundfordringar, 1600 Övriga
 * fordringar, 1700 Förskott till leverantörer, 2440 Leverantörsskulder and
 * 2900 Övriga skulder.
 *
 * Notably absent, because K1 says so: a premium for insurance covering two
 * years is expensed in full when paid (BFN:s vägledning till punkterna
 * 6.59-6.64), avsättningar are never made (punkt 6.67), and a first raised
 * leasing rent - the one item K1 does spread over time - is left for the day
 * someone has one.
 */
export type Bokslutsposttyp =
  | 'obetald_kundfaktura'
  | 'obetald_leverantorsfaktura'
  | 'forskott_till_leverantor'
  | 'forskott_fran_kund'
  | 'upplupen_ranteintakt'
  | 'upplupen_rantekostnad'
  | 'forutbetald_rantekostnad'
  | 'beslutad_ersattning';

export interface Bokslutspostbeskrivning {
  readonly namn: string;
  /** What it is, for someone who does not know bookkeeping. */
  readonly forklaring: string;
  readonly kalla: string;
  /** Taken up only above 5 000 kr exklusive moms. */
  readonly beloppsgrans: boolean;
  /** An invoice is entered with its moms; everything else without. */
  readonly medMoms: boolean;
  /** Where the amount waits over the year end. */
  readonly balanskonto: Kontonummer;
  /** The income or cost account it adjusts, when there is an obvious one. */
  readonly motkonto?: Kontonummer;
  readonly motkontoArIntakt: boolean;
}

export const BOKSLUTSPOSTER: Readonly<Record<Bokslutsposttyp, Bokslutspostbeskrivning>> =
  {
    obetald_kundfaktura: {
      namn: 'Obetald kundfaktura',
      forklaring:
        'En faktura du skickat men inte fått betalt för när året tog slut. Momsen ska med i årets sista momsdeklaration.',
      kalla: 'BFNAR 2006:1 punkt 6.56 och 7.1 b',
      beloppsgrans: false,
      medMoms: true,
      balanskonto: kontonummer('1500'),
      motkonto: kontonummer('3000'),
      motkontoArIntakt: true,
    },
    obetald_leverantorsfaktura: {
      namn: 'Obetald leverantörsfaktura',
      forklaring:
        'En faktura du fått men inte betalt när året tog slut. Momsen ska med i årets sista momsdeklaration.',
      kalla: 'BFNAR 2006:1 punkt 6.70 och 7.7 b',
      beloppsgrans: false,
      medMoms: true,
      balanskonto: kontonummer('2440'),
      motkonto: kontonummer('4000'),
      motkontoArIntakt: false,
    },
    forskott_till_leverantor: {
      namn: 'Förskott till leverantör',
      forklaring:
        'Något du betalat i förväg där leveransen eller arbetet inte hade börjat vid årets slut. Tas bara upp över 5 000 kr utan moms.',
      kalla: 'BFNAR 2006:1 punkt 6.59 och 7.7 c',
      beloppsgrans: true,
      medMoms: false,
      balanskonto: kontonummer('1700'),
      motkonto: kontonummer('4000'),
      motkontoArIntakt: false,
    },
    forskott_fran_kund: {
      namn: 'Förskott från kund',
      forklaring:
        'Betalt i förväg av en kund, där du inte börjat leverera vid årets slut. Tas bara upp över 5 000 kr utan moms.',
      kalla: 'BFNAR 2006:1 punkt 6.72 och 7.1 c',
      beloppsgrans: true,
      medMoms: false,
      balanskonto: kontonummer('2900'),
      motkonto: kontonummer('3000'),
      motkontoArIntakt: true,
    },
    upplupen_ranteintakt: {
      namn: 'Ränta att få',
      forklaring:
        'Ränta som hör till året men betalas ut först nästa år. Tas bara upp över 5 000 kr sammanlagt.',
      kalla: 'BFNAR 2006:1 punkt 6.60 och 7.6',
      beloppsgrans: true,
      medMoms: false,
      balanskonto: kontonummer('1600'),
      motkonto: kontonummer('8310'),
      motkontoArIntakt: true,
    },
    upplupen_rantekostnad: {
      namn: 'Ränta att betala',
      forklaring:
        'Ränta som hör till året men betalas först nästa år. Tas bara upp över 5 000 kr sammanlagt.',
      kalla: 'BFNAR 2006:1 punkt 6.73 och 7.11',
      beloppsgrans: true,
      medMoms: false,
      balanskonto: kontonummer('2900'),
      motkonto: kontonummer('8410'),
      motkontoArIntakt: false,
    },
    forutbetald_rantekostnad: {
      namn: 'Ränta betald i förväg',
      forklaring:
        'Ränta du betalat under året som hör till nästa år. Tas bara upp över 5 000 kr sammanlagt.',
      kalla: 'BFN:s vägledning till punkterna 6.59-6.64, Övriga fordringar',
      beloppsgrans: true,
      medMoms: false,
      balanskonto: kontonummer('1600'),
      motkonto: kontonummer('8410'),
      motkontoArIntakt: false,
    },
    beslutad_ersattning: {
      namn: 'Beslutat stöd eller ersättning',
      forklaring:
        'Ett stöd, en försäkringsersättning eller ett skadestånd som är beslutat under året men inte utbetalt.',
      kalla: 'BFNAR 2006:1 punkt 6.61 och 7.2',
      beloppsgrans: false,
      medMoms: false,
      balanskonto: kontonummer('1600'),
      motkontoArIntakt: true,
    },
  };

/** "Överstigande 5 000 kr" - strictly more than, exklusive avdragsgill moms. */
export const BELOPPSGRANS: Ore = oreFromKronor('5000');

export interface Bokslutspost {
  readonly typ: Bokslutsposttyp;
  /** With moms for an invoice, without for everything else. */
  readonly belopp: Ore;
  /** Whole percent; invoices only. */
  readonly momssats?: number;
  readonly motkonto: Kontonummer;
  readonly balanskonto: Kontonummer;
  /** Defaults to the BAS account for the direction and rate. */
  readonly momskonto?: Kontonummer;
}

/**
 * The rows that take the item up on the year's last day.
 *
 * An unpaid invoice is booked the way a paid one would have been, with the
 * balance account where the bank would have been - moms included, since the
 * last momsdeklaration of the year declares moms on unpaid invoices under
 * the kontantmetod (Skatteverket, Bokslutsmetoden). Everything else moves an
 * amount between its income or cost account and the balance account.
 */
export function bokslutspostKonteringar(post: Bokslutspost): Kontering[] {
  const beskrivning = BOKSLUTSPOSTER[post.typ];

  if (post.belopp <= 0) {
    throw new RangeError('Beloppet måste vara större än noll.');
  }
  if (beskrivning.beloppsgrans && post.belopp <= BELOPPSGRANS) {
    throw new RangeError(
      `${beskrivning.namn} tas bara upp när det överstiger 5 000 kr (${beskrivning.kalla}). ` +
        'Ett mindre belopp bokförs som vanligt när pengarna rör sig.',
    );
  }

  if (beskrivning.medMoms) {
    const momssats = post.momssats ?? 0;
    const { brutto, netto, moms } = delaBelopp(post.belopp, momssats);
    const intakt = beskrivning.motkontoArIntakt;
    const momskonto =
      post.momskonto ?? forvaltMomskonto(intakt ? 'inkomst' : 'utgift', momssats);
    const momsrad: Kontering[] =
      moms === 0 || momskonto === undefined
        ? []
        : [{ konto: momskonto, belopp: intakt ? negate(moms) : moms }];

    return intakt
      ? [
          { konto: post.balanskonto, belopp: brutto },
          { konto: post.motkonto, belopp: negate(netto) },
          ...momsrad,
        ]
      : [
          { konto: post.motkonto, belopp: netto },
          ...momsrad,
          { konto: post.balanskonto, belopp: negate(brutto) },
        ];
  }

  // A fordran waits on the asset side and takes from income or cost; a skuld
  // the other way round.
  const arFordran = Number(post.balanskonto) < 2000;
  return arFordran
    ? [
        { konto: post.balanskonto, belopp: post.belopp },
        { konto: post.motkonto, belopp: negate(post.belopp) },
      ]
    : [
        { konto: post.motkonto, belopp: post.belopp },
        { konto: post.balanskonto, belopp: negate(post.belopp) },
      ];
}

/**
 * The same rows the other way round, for the first day of the next year.
 *
 * K1 counts the year's income and cost as what was received and paid, plus
 * the difference in these items between the year's start and end (punkt 7.1
 * and 7.7). Reversing them on the first day is what makes the next year's
 * payment count once: the invoice paid in January meets its own reversal,
 * and its moms is not declared twice.
 */
export function aterforing(konteringar: readonly Kontering[]): Kontering[] {
  return konteringar.map((rad) => ({ konto: rad.konto, belopp: negate(rad.belopp) }));
}
