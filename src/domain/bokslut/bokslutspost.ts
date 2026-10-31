import { negate, oreFromKronor, type Ore } from '../belopp/ore';
import type { Bokprofil } from '../bok/bokprofil';
import { kontonummer, type Kontonummer } from '../konto/konto';
import { delaBelopp } from '../mall/konteringsmall';
import type { Uuid } from '../id/uuidv7';
import { forvaltMomskonto } from '../moms/momskonto';
import { medProjektPaKonto } from '../projekt/projekt';
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

/**
 * What an association takes up at the year's end, beyond the bokföring made
 * when money moved (BFNAR 2010:1 kapitel 6 and 7).
 *
 * The same idea as the firm's list, and mostly the same items, but with the
 * association's own accounts and sources - and two items of its own, for
 * bidrag. An association may recognise a grant in the year it is paid or in
 * the year it relates to (punkt 7.3); when it follows the year it relates to,
 * a grant decided but not yet paid is a fordran (6.53) and the part paid for a
 * coming year is a skuld (6.76).
 */
export type Foreningsposttyp =
  | 'obetald_kundfaktura'
  | 'obetald_leverantorsfaktura'
  | 'forskott_till_leverantor'
  | 'forskott_fran_kund'
  | 'upplupen_ranteintakt'
  | 'upplupen_rantekostnad'
  | 'beslutat_bidrag'
  | 'bidrag_for_kommande_ar';

/** Every kind of item a book of any profile can take up. */
export type Posttyp = Bokslutsposttyp | Foreningsposttyp;

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

const BFNAR_FORENING = 'BFNAR 2010:1';

/**
 * The association's items, with its accounts (FORENINGENS_GRUNDKONTON): 1510
 * kundfordringar, 1600 övriga fordringar, 2440 leverantörsskulder and 2900
 * övriga skulder.
 *
 * None of them splits off moms. An association that is not registered for
 * moms deducts none, so the moms of an invoice is part of its amount (punkt
 * 6.71, 7.12 c) - which is also why the invoice items take their amount with
 * the moms in it and have no moms rate.
 *
 * Absent on purpose: the item for interest paid in advance, which the firm's
 * list has from BFN's guidance to K1 and which BFNAR 2010:1 does not mention,
 * and a conditional grant released as income, which is no accrual but a
 * permanent move from skuld to intäkt and is booked as a free posting.
 */
export const FORENINGENS_BOKSLUTSPOSTER: Readonly<
  Record<Foreningsposttyp, Bokslutspostbeskrivning>
> = {
  beslutat_bidrag: {
    namn: 'Beslutat bidrag som inte betalats ut',
    forklaring:
      'Ett bidrag som är beslutat för året men som ännu inte betalats ut när året tog slut. Det tas bara upp om det finns ett beslut och dokumentation om beloppet innan bokslutet är färdigt, och bara om föreningen redovisar bidrag det år de hör till.',
    kalla: `${BFNAR_FORENING} punkt 6.53 och 7.3 b`,
    beloppsgrans: false,
    medMoms: false,
    balanskonto: kontonummer('1600'),
    motkonto: kontonummer('3710'),
    motkontoArIntakt: true,
  },
  bidrag_for_kommande_ar: {
    namn: 'Bidrag som hör till nästa år',
    forklaring:
      'Den del av ett bidrag som föreningen fått betalt men som hör till ett kommande räkenskapsår. Gäller bara om föreningen redovisar bidrag det år de hör till. Redovisar den dem när de betalas ska inget tas upp.',
    kalla: `${BFNAR_FORENING} punkt 6.76 och 7.3 b`,
    beloppsgrans: false,
    medMoms: false,
    balanskonto: kontonummer('2900'),
    motkonto: kontonummer('3710'),
    motkontoArIntakt: true,
  },
  obetald_kundfaktura: {
    namn: 'Obetald faktura till kund',
    forklaring:
      'En faktura föreningen skickat, till exempel för uthyrning, men inte fått betalt för när året tog slut. En medlemsavgift tas aldrig upp som kundfordran.',
    kalla: `${BFNAR_FORENING} punkt 6.48, 7.5 b och 7.6 b`,
    beloppsgrans: false,
    medMoms: false,
    balanskonto: kontonummer('1510'),
    motkonto: kontonummer('3811'),
    motkontoArIntakt: true,
  },
  obetald_leverantorsfaktura: {
    namn: 'Obetald leverantörsfaktura',
    forklaring:
      'En faktura föreningen fått men inte betalat när året tog slut. Beloppet är med moms, eftersom en förening utan momsregistrering inte drar av moms.',
    kalla: `${BFNAR_FORENING} punkt 6.70, 6.71 och 7.12 c`,
    beloppsgrans: false,
    medMoms: false,
    balanskonto: kontonummer('2440'),
    motkonto: kontonummer('6390'),
    motkontoArIntakt: false,
  },
  forskott_fran_kund: {
    namn: 'Förskott från hyresgäst eller kund',
    forklaring:
      'Betalt i förväg av någon där föreningen inte börjat leverera vid årets slut, till exempel en hyra. Tas bara upp över 5 000 kr. En medlemsavgift är aldrig ett förskott.',
    kalla: `${BFNAR_FORENING} punkt 6.73 och 7.5 c`,
    beloppsgrans: true,
    medMoms: false,
    balanskonto: kontonummer('2900'),
    motkonto: kontonummer('3811'),
    motkontoArIntakt: true,
  },
  forskott_till_leverantor: {
    namn: 'Förskott till leverantör',
    forklaring:
      'Något föreningen betalat i förväg där leveransen eller arbetet inte hade börjat vid årets slut. Tas bara upp över 5 000 kr utan avdragsgill moms.',
    kalla: `${BFNAR_FORENING} punkt 6.51 och 7.12 d`,
    beloppsgrans: true,
    medMoms: false,
    balanskonto: kontonummer('1600'),
    motkonto: kontonummer('6390'),
    motkontoArIntakt: false,
  },
  upplupen_ranteintakt: {
    namn: 'Ränta att få',
    forklaring:
      'Ränta som hör till året men betalas ut först nästa år. Tas bara upp över 5 000 kr sammanlagt.',
    kalla: `${BFNAR_FORENING} punkt 6.52 och 7.9`,
    beloppsgrans: true,
    medMoms: false,
    balanskonto: kontonummer('1600'),
    motkonto: kontonummer('8300'),
    motkontoArIntakt: true,
  },
  upplupen_rantekostnad: {
    namn: 'Ränta att betala',
    forklaring:
      'Ränta som hör till året men betalas först nästa år. Tas bara upp över 5 000 kr sammanlagt.',
    kalla: `${BFNAR_FORENING} punkt 6.75`,
    beloppsgrans: true,
    medMoms: false,
    balanskonto: kontonummer('2900'),
    motkonto: kontonummer('8400'),
    motkontoArIntakt: false,
  },
};

/** The items a book of this kind takes up at the year's end. */
export function bokslutskatalogFor(profil: Bokprofil): Bokslutskatalog {
  return profil === 'forening' ? FORENINGENS_BOKSLUTSPOSTER : BOKSLUTSPOSTER;
}

/** "Överstigande 5 000 kr" - strictly more than, exklusive avdragsgill moms. */
export const BELOPPSGRANS: Ore = oreFromKronor('5000');

/** The items one kind of book offers, each with its accounts and its source. */
export type Bokslutskatalog = Readonly<Partial<Record<Posttyp, Bokslutspostbeskrivning>>>;

export interface Bokslutspost {
  readonly typ: Posttyp;
  /** With moms for an invoice, without for everything else. */
  readonly belopp: Ore;
  /** Whole percent; invoices only. */
  readonly momssats?: number;
  readonly motkonto: Kontonummer;
  readonly balanskonto: Kontonummer;
  /** Defaults to the BAS account for the direction and rate. */
  readonly momskonto?: Kontonummer;
  /**
   * The project the item belongs to. It is set on the income or cost row and
   * on the balance row, so that a skuld for a grant can be followed on its own;
   * the moms row is no part of a project.
   */
  readonly projekt?: Uuid;
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
export function bokslutspostKonteringar(
  post: Bokslutspost,
  katalog: Bokslutskatalog = BOKSLUTSPOSTER,
): Kontering[] {
  const rader = grundkonteringar(post, katalog);
  return medProjektPaKonto(
    medProjektPaKonto(rader, post.motkonto, post.projekt),
    post.balanskonto,
    post.projekt,
  );
}

function grundkonteringar(post: Bokslutspost, katalog: Bokslutskatalog): Kontering[] {
  const beskrivning = katalog[post.typ];
  if (beskrivning === undefined) {
    throw new RangeError(`Den här sortens bok tar inte upp ${post.typ} vid årets slut.`);
  }

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
  // The whole row, turned: a project the item was booked on goes back with it.
  return konteringar.map((rad) => ({ ...rad, belopp: negate(rad.belopp) }));
}
