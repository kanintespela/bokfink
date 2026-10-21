import { add, isZero, negate, sum, ZERO, type Ore } from '../belopp/ore';
import type { Kontonummer } from '../konto/konto';
import type { Kontosaldo } from '../rapport/saldon';

/**
 * The boxes of the förenklade årsbokslutet for enskilda näringsidkare (BFNAR
 * 2006:1), the statutory summary a K1 bookkeeper closes the year with - and
 * the same box codes the NE-bilaga carries, so this is also what the NE and
 * SRU export will be built on.
 *
 * B11 and B12 (obeskattade reserver, avsättningar) do not exist here: an
 * enskild näringsidkare under K1 has neither. U1-U4 are upplysningar only,
 * shown beside the balance sheet but never summed into it.
 */
export type Balansrad =
  | 'B1'
  | 'B2'
  | 'B3'
  | 'B4'
  | 'B5'
  | 'B6'
  | 'B7'
  | 'B8'
  | 'B9'
  | 'B10'
  | 'B13'
  | 'B14'
  | 'B15'
  | 'B16';

export type Resultatrad =
  'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10';

export type Uppgiftsrad = 'U1' | 'U2' | 'U3' | 'U4';

export type Bokslutsrad = Balansrad | Resultatrad | Uppgiftsrad;

/** The box labels as BAS prints them in the K1 minimikontoplan 2018. */
export const RUBRIKER: Readonly<Record<Bokslutsrad, string>> = {
  B1: 'Immateriella anläggningstillgångar',
  B2: 'Byggnader och markanläggningar',
  B3: 'Mark och andra tillgångar som inte får skrivas av',
  B4: 'Maskiner och inventarier',
  B5: 'Övriga anläggningstillgångar',
  B6: 'Varulager',
  B7: 'Kundfordringar',
  B8: 'Övriga fordringar',
  B9: 'Kassa och bank',
  B10: 'Eget kapital',
  B13: 'Låneskulder',
  B14: 'Skatteskulder',
  B15: 'Leverantörsskulder',
  B16: 'Övriga skulder',
  R1: 'Försäljning och utfört arbete samt övriga momspliktiga intäkter',
  R2: 'Momsfria intäkter',
  R3: 'Bil- och bostadsförmån m.m.',
  R4: 'Ränteintäkter',
  R5: 'Varor, material och tjänster',
  R6: 'Övriga externa kostnader',
  R7: 'Anställd personal',
  R8: 'Räntekostnader m.m.',
  R9: 'Avskrivningar och nedskrivningar av byggnader och markanläggningar',
  R10: 'Avskrivningar och nedskrivningar av maskiner och inventarier och immateriella tillgångar',
  U1: 'Periodiseringsfonder',
  U2: 'Expansionsfond',
  U3: 'Ersättningsfonder',
  U4: 'Insatsemissioner, skogskonto, upphovsmannakonto, avbetalningsplan på skog o.d.',
};

export const TILLGANGSRADER: readonly Balansrad[] = [
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'B6',
  'B7',
  'B8',
  'B9',
];
export const SKULDRADER: readonly Balansrad[] = ['B10', 'B13', 'B14', 'B15', 'B16'];
export const INTAKTSRADER: readonly Resultatrad[] = ['R1', 'R2', 'R3', 'R4'];
export const KOSTNADSRADER: readonly Resultatrad[] = [
  'R5',
  'R6',
  'R7',
  'R8',
  'R9',
  'R10',
];
export const UPPGIFTSRADER: readonly Uppgiftsrad[] = ['U1', 'U2', 'U3', 'U4'];

/**
 * Where an account goes on the form.
 *
 * - `rad`: one box, decided by the account number.
 * - `val`: BAS names two boxes, because the right one depends on what the
 *   booking concerns rather than on the number - a rabatt follows the sale
 *   it was given on, which may or may not have carried moms. Kontera does
 *   not know that, so the user chooses (hard rule 10).
 * - `eget-kapital`: part of B10, which also takes in the year's result.
 * - `utjamning`: 2090, the counter-entry that keeps U1-U4 out of B10.
 * - `resultatoverforing`: 8990-8999, where the year's result is moved into
 *   eget kapital. Not a box of its own; R11 is computed from R1-R10.
 */
export type Placering =
  | { readonly typ: 'rad'; readonly rad: Exclude<Bokslutsrad, 'B10'> }
  | { readonly typ: 'val'; readonly alternativ: readonly [Resultatrad, Resultatrad] }
  | { readonly typ: 'eget-kapital' }
  | { readonly typ: 'utjamning' }
  | { readonly typ: 'resultatoverforing' };

/**
 * BAS-konto → box, transcribed from "BAS Förenklat årsbokslut (K1) -
 * Kontoplan 2018" and its minimikontoplan (bas.se; unchanged since 2017, and
 * the newest K1 version BAS publishes as of 2026-09).
 *
 * Only ranges that table covers are here. A BAS-grupp it leaves out - 18
 * kortfristiga placeringar, 21-22 obeskattade reserver och avsättningar, 25
 * skatteskulder, 28, 36, 38, 48, 88 bokslutsdispositioner and a few more -
 * gets no box, and the account is reported as unplaced instead of being
 * guessed into one. Where the table gives a whole kontogrupp one box, the
 * whole group is mapped (5000-6999 all go to R6 under the table's own
 * heading "Övriga externa rörelseutgifter/kostnader").
 *
 * The first matching range wins, so narrower ranges come before the wider
 * one they carve out of.
 */
const KONTOTABELL: readonly {
  readonly fran: number;
  readonly till: number;
  readonly placering: Placering;
}[] = [
  // 1 Tillgångar
  { fran: 1000, till: 1099, placering: rad('B1') },
  { fran: 1100, till: 1129, placering: rad('B2') }, // Byggnader
  { fran: 1130, till: 1149, placering: rad('B3') }, // Mark
  { fran: 1150, till: 1179, placering: rad('B2') }, // Markanläggningar
  { fran: 1180, till: 1199, placering: rad('B3') }, // Pågående nyanläggningar
  { fran: 1200, till: 1299, placering: rad('B4') },
  { fran: 1300, till: 1399, placering: rad('B5') },
  { fran: 1400, till: 1499, placering: rad('B6') },
  { fran: 1500, till: 1599, placering: rad('B7') },
  { fran: 1600, till: 1799, placering: rad('B8') }, // Inklusive förskott till leverantörer
  { fran: 1900, till: 1999, placering: rad('B9') },

  // 2 Eget kapital och skulder
  { fran: 2000, till: 2049, placering: { typ: 'eget-kapital' } },
  { fran: 2050, till: 2059, placering: rad('U2') },
  { fran: 2060, till: 2069, placering: rad('U3') },
  { fran: 2070, till: 2079, placering: rad('U4') },
  { fran: 2080, till: 2089, placering: rad('U1') },
  { fran: 2090, till: 2099, placering: { typ: 'utjamning' } },
  { fran: 2300, till: 2399, placering: rad('B13') },
  { fran: 2400, till: 2499, placering: rad('B15') },
  { fran: 2600, till: 2799, placering: rad('B14') }, // Moms och personalens skatter
  { fran: 2900, till: 2999, placering: rad('B16') },

  // 3 Rörelsens inkomster/intäkter
  { fran: 3000, till: 3099, placering: rad('R1') },
  { fran: 3100, till: 3199, placering: rad('R2') },
  { fran: 3200, till: 3299, placering: rad('R3') },
  { fran: 3500, till: 3599, placering: rad('R1') }, // Fakturerade kostnader
  { fran: 3700, till: 3799, placering: val('R1', 'R2') }, // Intäktskorrigeringar
  { fran: 3970, till: 3989, placering: rad('R2') }, // Vinst vid avyttring, erhållna bidrag
  { fran: 3900, till: 3999, placering: val('R1', 'R2') }, // Övriga rörelseintäkter

  // 4 Varor, material och vissa köpta tjänster
  { fran: 4000, till: 4599, placering: rad('R5') },
  { fran: 4600, till: 4699, placering: rad('R5') },
  { fran: 4700, till: 4799, placering: rad('R6') }, // Erhållna rabatter - R6 enligt BAS
  { fran: 4900, till: 4999, placering: rad('R5') },

  // 5-6 Övriga externa rörelseutgifter/kostnader
  { fran: 5000, till: 6999, placering: rad('R6') },

  // 7 Personal, avskrivningar
  { fran: 7000, till: 7699, placering: rad('R7') },
  { fran: 7700, till: 7799, placering: val('R9', 'R10') }, // Nedskrivningar
  { fran: 7810, till: 7819, placering: rad('R10') }, // Immateriella
  { fran: 7820, till: 7829, placering: rad('R9') }, // Byggnader och markanläggningar
  { fran: 7830, till: 7839, placering: rad('R10') }, // Maskiner och inventarier
  { fran: 7970, till: 7979, placering: rad('R6') }, // Förlust vid avyttring
  { fran: 7980, till: 7989, placering: val('R9', 'R10') }, // Ersättningsfonder

  // 8 Finansiella poster och årets resultat
  { fran: 8300, till: 8399, placering: rad('R4') },
  { fran: 8400, till: 8499, placering: rad('R8') },
  { fran: 8990, till: 8999, placering: { typ: 'resultatoverforing' } },
];

function rad(rad: Exclude<Bokslutsrad, 'B10'>): Placering {
  return { typ: 'rad', rad };
}

function val(forsta: Resultatrad, andra: Resultatrad): Placering {
  return { typ: 'val', alternativ: [forsta, andra] };
}

/** Undefined when the K1 table gives the account no place on the form. */
export function placeringForKonto(konto: Kontonummer): Placering | undefined {
  const nummer = Number(konto);
  return KONTOTABELL.find((post) => nummer >= post.fran && nummer <= post.till)
    ?.placering;
}

/** True when `rad` is one of the boxes BAS allows for an ambiguous `konto`. */
export function arGiltigtRutval(konto: Kontonummer, rad: Resultatrad): boolean {
  const placering = placeringForKonto(konto);
  return placering?.typ === 'val' && placering.alternativ.includes(rad);
}

/** One account's contribution to a box, with the sign the form prints. */
export interface Bokslutspost {
  readonly konto: Kontonummer;
  readonly belopp: Ore;
}

export interface Bokslutsruta {
  readonly rad: Bokslutsrad;
  readonly belopp: Ore;
  readonly poster: readonly Bokslutspost[];
}

export interface KontoSomKraverVal {
  readonly konto: Kontonummer;
  readonly alternativ: readonly [Resultatrad, Resultatrad];
  /** Positive is an income, as R1-R4 print it. */
  readonly belopp: Ore;
}

export interface ForenkladArsbokslut {
  /** Only boxes with something in them. */
  readonly rutor: ReadonlyMap<Bokslutsrad, Bokslutsruta>;
  readonly summaTillgangar: Ore;
  readonly summaEgetKapitalOchSkulder: Ore;
  /**
   * The part of B10 that is the year's result still sitting on the result
   * accounts. Zero once a closing entry (8999 against 2019) has moved it.
   */
  readonly resultatEjOverfortTillEgetKapital: Ore;
  /** R11: R1-R4 less R5-R10. */
  readonly bokfortResultat: Ore;
  /** The year's result as the ledger has it, from every result account. */
  readonly resultatEnligtBokforingen: Ore;
  /** Summa tillgångar less summa eget kapital och skulder. */
  readonly differens: Ore;
  /** R11 less the ledger's own result. */
  readonly resultatdifferens: Ore;
  /** Accounts with a balance that the K1 table gives no box. */
  readonly kontonUtanRuta: readonly Kontosaldo[];
  /** Accounts BAS allows in two boxes and the user has not yet placed. */
  readonly kraverVal: readonly KontoSomKraverVal[];
}

/**
 * Sorts a year's closing balances into the förenklade årsbokslutets boxes.
 *
 * `val` places the accounts BAS allows in two boxes; an account that needs
 * a choice and has none is left out of R1-R10 and listed in `kraverVal`.
 *
 * Signs follow each box's side of the form: assets and costs are debited in
 * the ledger and print as they stand, eget kapital, skulder and intäkter are
 * credited and are negated once, here, so the form reads positive.
 *
 * B10 is eget kapital at the year's end, and the form has no separate line
 * for the result on the balance side - so B10 takes in whatever part of the
 * result has not yet been booked over to eget kapital. That makes the figure
 * the same before and after a closing entry, which is what lets Kontera book
 * one too (beslut 2026-09-13, see src/domain/bokslut/egetkapital.ts) without
 * this table needing to know whether it happened.
 *
 * Nothing is dropped quietly (hard rule 11). An account without a box, or an
 * ambiguous one without a choice, is listed, and shows up again as a
 * difference on the side of the form it belongs to.
 */
export function beraknaForenkladArsbokslut(
  saldon: ReadonlyMap<Kontonummer, Kontosaldo>,
  val: ReadonlyMap<Kontonummer, Resultatrad> = new Map(),
): ForenkladArsbokslut {
  const poster = new Map<Bokslutsrad, Bokslutspost[]>();
  const lagg = (rad: Bokslutsrad, konto: Kontonummer, saldo: Ore) => {
    const belopp = pakreditsidan(rad) ? negate(saldo) : saldo;
    poster.set(rad, [...(poster.get(rad) ?? []), { konto, belopp }]);
  };

  const kontonUtanRuta: Kontosaldo[] = [];
  const kraverVal: KontoSomKraverVal[] = [];
  let resultatkonton = ZERO;
  let resultatoverforing = ZERO;

  for (const [konto, valt] of val) {
    if (!arGiltigtRutval(konto, valt)) {
      throw new TypeError(`Konto ${konto} kan inte placeras i ruta ${valt}.`);
    }
  }

  for (const saldo of [...saldon.values()].sort((a, b) =>
    a.konto.localeCompare(b.konto),
  )) {
    if (arResultatkonto(saldo.konto)) {
      resultatkonton = add(resultatkonton, saldo.utgaende);
    }
    if (isZero(saldo.utgaende)) {
      continue;
    }

    const placering = placeringForKonto(saldo.konto);
    switch (placering?.typ) {
      case undefined:
        kontonUtanRuta.push(saldo);
        break;
      case 'rad':
        lagg(placering.rad, saldo.konto, saldo.utgaende);
        break;
      case 'eget-kapital':
        lagg('B10', saldo.konto, saldo.utgaende);
        break;
      case 'val': {
        const valt = val.get(saldo.konto);
        if (valt === undefined) {
          kraverVal.push({
            konto: saldo.konto,
            alternativ: placering.alternativ,
            belopp: negate(saldo.utgaende),
          });
        } else {
          lagg(valt, saldo.konto, saldo.utgaende);
        }
        break;
      }
      case 'utjamning':
        // Offsets U1-U4 inside eget kapital. Neither side of the form
        // carries it, just as neither carries the upplysningar it offsets.
        break;
      case 'resultatoverforing':
        resultatoverforing = add(resultatoverforing, saldo.utgaende);
        break;
    }
  }

  // Every result account, placed or not, is the year's result as the ledger
  // has it. Ledger signs: a profit is a credit, so negated once.
  const resultatEjOverfort = negate(resultatkonton);
  const resultatEnligtBokforingen = negate(
    add(resultatkonton, negate(resultatoverforing)),
  );

  const rutor = new Map<Bokslutsrad, Bokslutsruta>();
  for (const [rad, radposter] of poster) {
    const belopp = sum(radposter.map((post) => post.belopp));
    const ejOverfort = rad === 'B10' ? resultatEjOverfort : ZERO;
    rutor.set(rad, { rad, belopp: add(belopp, ejOverfort), poster: radposter });
  }
  if (!rutor.has('B10') && !isZero(resultatEjOverfort)) {
    rutor.set('B10', { rad: 'B10', belopp: resultatEjOverfort, poster: [] });
  }

  const summa = (rader: readonly Bokslutsrad[]): Ore =>
    sum(rader.map((rad) => rutor.get(rad)?.belopp ?? ZERO));

  const summaTillgangar = summa(TILLGANGSRADER);
  const summaEgetKapitalOchSkulder = summa(SKULDRADER);
  const bokfortResultat = add(summa(INTAKTSRADER), negate(summa(KOSTNADSRADER)));

  return {
    rutor,
    summaTillgangar,
    summaEgetKapitalOchSkulder,
    resultatEjOverfortTillEgetKapital: resultatEjOverfort,
    bokfortResultat,
    resultatEnligtBokforingen,
    differens: add(summaTillgangar, negate(summaEgetKapitalOchSkulder)),
    resultatdifferens: add(bokfortResultat, negate(resultatEnligtBokforingen)),
    kontonUtanRuta,
    kraverVal,
  };
}

function pakreditsidan(rad: Bokslutsrad): boolean {
  return (
    SKULDRADER.includes(rad as Balansrad) ||
    INTAKTSRADER.includes(rad as Resultatrad) ||
    UPPGIFTSRADER.includes(rad as Uppgiftsrad)
  );
}

function arResultatkonto(konto: Kontonummer): boolean {
  return Number(konto) >= 3000;
}
