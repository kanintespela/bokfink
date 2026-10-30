import { add, negate, sum, ZERO, type Ore } from '../belopp/ore';
import type { Kontonummer } from '../konto/konto';
import type { Kontosaldo } from '../rapport/saldon';

/**
 * Förenklat årsbokslut för en ideell förening, enligt uppställningsformen i
 * bilaga 2 till BFNAR 2010:1 (i dess lydelse efter BFNAR 2024:6).
 *
 * Uppställningen är sluten: en förening får anpassa en posts benämning men
 * inte lägga till, slå ihop eller byta rubriker (kapitel 5 i vägledningen),
 * och får utelämna en post som saknar belopp. Raderna nedan är därför exakt
 * bilagans, och det är kontona som placeras på dem - inte raderna som bygger
 * på kontona.
 *
 * Vilken rad ett konto hör till är i sista hand föreningens bedömning. Bilagan
 * säger till exempel att en medlemstidning är verksamhetskostnad och en hyra
 * en övrig extern kostnad, men ger ingen kontoplan. Förvalen här följer
 * kontoklasserna och är förslag; en förening kan flytta ett konto till en
 * annan rad av samma slag och bör kontrollera placeringen med sin revisor.
 */
export const RESULTATRADER = [
  'medlemsavgifter',
  'gavor_och_bidrag',
  'ovriga_verksamhetsintakter',
  'forsaljningsintakter',
  'ovriga_intakter',
  'verksamhetskostnader',
  'forsaljningskostnader',
  'ovriga_externa_kostnader',
  'personalkostnader',
  'av_och_nedskrivningar',
  'ovriga_kostnader',
  'finansiella_intakter',
  'finansiella_kostnader',
  'bokslutsdispositioner',
  'skatt',
] as const;

export const BALANSRADER = [
  'immateriella_tillgangar',
  'byggnader_och_mark',
  'inventarier',
  'varulager',
  'kundfordringar',
  'ovriga_fordringar',
  'finansiella_placeringar',
  'kassa_och_bank',
  'obeskattade_reserver',
  'laneskulder',
  'leverantorsskulder',
  'skatteskulder',
  'ovriga_skulder',
] as const;

export type Resultatrad = (typeof RESULTATRADER)[number];
export type Balansrad = (typeof BALANSRADER)[number];
export type Foreningsrad = Resultatrad | Balansrad;

/** The posts' names as bilaga 2 prints them. */
export const RADNAMN: Record<Foreningsrad, string> = {
  medlemsavgifter: 'Medlemsavgifter',
  gavor_och_bidrag: 'Gåvor och bidrag',
  ovriga_verksamhetsintakter: 'Övriga verksamhetsintäkter',
  forsaljningsintakter: 'Försäljningsintäkter',
  ovriga_intakter: 'Övriga intäkter',
  verksamhetskostnader: 'Verksamhetskostnader',
  forsaljningskostnader: 'Försäljningskostnader',
  ovriga_externa_kostnader: 'Övriga externa kostnader',
  personalkostnader: 'Personalkostnader',
  av_och_nedskrivningar:
    'Av- och nedskrivningar av materiella och immateriella anläggningstillgångar',
  ovriga_kostnader: 'Övriga kostnader',
  finansiella_intakter: 'Finansiella intäkter',
  finansiella_kostnader: 'Finansiella kostnader',
  bokslutsdispositioner: 'Bokslutsdispositioner',
  skatt: 'Skatt',
  immateriella_tillgangar: 'Immateriella anläggningstillgångar',
  byggnader_och_mark: 'Byggnader och mark',
  inventarier: 'Inventarier',
  varulager: 'Varulager',
  kundfordringar: 'Kundfordringar',
  ovriga_fordringar: 'Övriga fordringar',
  finansiella_placeringar: 'Finansiella placeringar',
  kassa_och_bank: 'Kassa och bank',
  obeskattade_reserver: 'Obeskattade reserver',
  laneskulder: 'Låneskulder',
  leverantorsskulder: 'Leverantörsskulder',
  skatteskulder: 'Skatteskulder',
  ovriga_skulder: 'Övriga skulder',
};

const INTAKTSRADER: readonly Resultatrad[] = [
  'medlemsavgifter',
  'gavor_och_bidrag',
  'ovriga_verksamhetsintakter',
  'forsaljningsintakter',
  'ovriga_intakter',
];
const KOSTNADSRADER: readonly Resultatrad[] = [
  'verksamhetskostnader',
  'forsaljningskostnader',
  'ovriga_externa_kostnader',
  'personalkostnader',
  'av_och_nedskrivningar',
  'ovriga_kostnader',
];
const TILLGANGSRADER: readonly Balansrad[] = [
  'immateriella_tillgangar',
  'byggnader_och_mark',
  'inventarier',
  'varulager',
  'kundfordringar',
  'ovriga_fordringar',
  'finansiella_placeringar',
  'kassa_och_bank',
];
const SKULDRADER: readonly Balansrad[] = [
  'laneskulder',
  'leverantorsskulder',
  'skatteskulder',
  'ovriga_skulder',
];

export function arResultatrad(rad: Foreningsrad): rad is Resultatrad {
  return (RESULTATRADER as readonly string[]).includes(rad);
}

/** Where the year's result is moved onto eget kapital; not a post of its own. */
type Overforing = 'resultatoverforing';
/** Eget kapital is worked out, not summed from accounts, so no account is placed on it. */
type Kapital = 'eget_kapital';

const FORVAL: readonly {
  readonly fran: number;
  readonly till: number;
  readonly rad: Foreningsrad | Overforing | Kapital;
}[] = [
  // 1 Tillgångar
  { fran: 1000, till: 1099, rad: 'immateriella_tillgangar' },
  { fran: 1100, till: 1199, rad: 'byggnader_och_mark' },
  { fran: 1200, till: 1299, rad: 'inventarier' },
  { fran: 1300, till: 1399, rad: 'finansiella_placeringar' },
  { fran: 1400, till: 1499, rad: 'varulager' },
  { fran: 1500, till: 1599, rad: 'kundfordringar' },
  { fran: 1600, till: 1799, rad: 'ovriga_fordringar' },
  { fran: 1800, till: 1899, rad: 'finansiella_placeringar' },
  { fran: 1900, till: 1999, rad: 'kassa_och_bank' },
  // 2 Eget kapital och skulder
  { fran: 2000, till: 2099, rad: 'eget_kapital' },
  { fran: 2100, till: 2199, rad: 'obeskattade_reserver' },
  { fran: 2300, till: 2399, rad: 'laneskulder' },
  { fran: 2400, till: 2499, rad: 'leverantorsskulder' },
  { fran: 2500, till: 2799, rad: 'skatteskulder' },
  { fran: 2800, till: 2999, rad: 'ovriga_skulder' },
  // 3 Intäkter. The narrow ranges come first: the first match wins.
  { fran: 3610, till: 3610, rad: 'medlemsavgifter' },
  { fran: 3740, till: 3740, rad: 'ovriga_verksamhetsintakter' },
  { fran: 3700, till: 3799, rad: 'gavor_och_bidrag' },
  { fran: 3970, till: 3979, rad: 'ovriga_intakter' },
  { fran: 3980, till: 3989, rad: 'gavor_och_bidrag' },
  { fran: 3000, till: 3399, rad: 'forsaljningsintakter' },
  { fran: 3400, till: 3999, rad: 'ovriga_verksamhetsintakter' },
  // 4-8 Kostnader och finansiella poster
  { fran: 4000, till: 4999, rad: 'forsaljningskostnader' },
  { fran: 5000, till: 6999, rad: 'ovriga_externa_kostnader' },
  { fran: 7000, till: 7699, rad: 'personalkostnader' },
  { fran: 7700, till: 7899, rad: 'av_och_nedskrivningar' },
  { fran: 7900, till: 7999, rad: 'ovriga_kostnader' },
  { fran: 8000, till: 8399, rad: 'finansiella_intakter' },
  { fran: 8400, till: 8799, rad: 'finansiella_kostnader' },
  { fran: 8800, till: 8899, rad: 'bokslutsdispositioner' },
  { fran: 8900, till: 8989, rad: 'skatt' },
  { fran: 8990, till: 8999, rad: 'resultatoverforing' },
];

/** The post an account goes to unless the association has said otherwise. */
export function forvalsradFor(
  konto: Kontonummer,
): Foreningsrad | Overforing | Kapital | undefined {
  const nummer = Number(konto);
  return FORVAL.find((post) => nummer >= post.fran && nummer <= post.till)?.rad;
}

/**
 * Whether an association may move an account to a post: a result account to
 * another result post, a balance account to another balance post, and neither
 * the capital accounts nor the transfer of the year's result anywhere.
 */
export function arGiltigtRadval(konto: Kontonummer, rad: Foreningsrad): boolean {
  const forval = forvalsradFor(konto);
  if (
    forval === undefined ||
    forval === 'eget_kapital' ||
    forval === 'resultatoverforing'
  ) {
    return false;
  }
  return arResultatrad(forval) === arResultatrad(rad);
}

export interface Radpost {
  readonly konto: Kontonummer;
  readonly belopp: Ore;
}

export interface Rad {
  readonly rad: Foreningsrad;
  readonly belopp: Ore;
  readonly poster: readonly Radpost[];
}

/**
 * The year as bilaga 2 sets it out.
 *
 * Signs are those of the printed form: income and a surplus are positive, a
 * cost is negative, so "Summa kostnader" is subtracted by adding it. On the
 * balance sheet every post is the size of the claim or debt it is.
 */
export interface Foreningsbokslut {
  readonly rader: ReadonlyMap<Foreningsrad, Rad>;
  readonly summaIntakter: Ore;
  readonly summaKostnader: Ore;
  readonly verksamhetensResultat: Ore;
  readonly resultatEfterFinansiellaPoster: Ore;
  readonly aretsResultat: Ore;
  readonly summaTillgangar: Ore;
  /** Eget kapital before the year's result: tillgångar less skulder less obeskattade reserver, less årets resultat. */
  readonly balanseratResultat: Ore;
  readonly summaEgetKapital: Ore;
  readonly summaSkulder: Ore;
  readonly summaEgetKapitalOchSkulder: Ore;
  /** Accounts holding a balance that no post takes: the bokslut is not done until there are none. */
  readonly kontonUtanRad: readonly Radpost[];
}

/**
 * Sets a year out on the form.
 *
 * Eget kapital is the difference between what the association owns and what it
 * owes (punkt 6.66), so it is worked out rather than summed, and the form
 * balances by construction. That is why an account that no post takes is
 * reported and must be placed: left out, it would shift the balance between
 * tillgångar and eget kapital without anything on the page showing it.
 *
 * Accounts 8990-8999, where the result is moved onto eget kapital, are in no
 * post, so the result is the same before and after that transfer.
 */
export function beraknaForeningsbokslut(
  saldon: ReadonlyMap<Kontonummer, Kontosaldo>,
  radval: ReadonlyMap<Kontonummer, Foreningsrad> = new Map(),
): Foreningsbokslut {
  const poster = new Map<Foreningsrad, Radpost[]>();
  const utanRad: Radpost[] = [];

  for (const saldo of saldon.values()) {
    const forval = forvalsradFor(saldo.konto);
    if (forval === 'eget_kapital' || forval === 'resultatoverforing') {
      continue;
    }
    const valt = radval.get(saldo.konto);
    const rad = valt !== undefined && arGiltigtRadval(saldo.konto, valt) ? valt : forval;
    const resultatkonto = Number(saldo.konto) >= 3000;
    // Ledger sign: income is credited and so negative. Printed once, here, the right way up.
    const ledger = resultatkonto ? saldo.forandring : saldo.utgaende;
    if (ledger === ZERO) {
      continue;
    }
    if (rad === undefined) {
      utanRad.push({ konto: saldo.konto, belopp: ledger });
      continue;
    }
    const tillgang = (TILLGANGSRADER as readonly string[]).includes(rad);
    const belopp = resultatkonto || !tillgang ? negate(ledger) : ledger;
    poster.set(rad, [...(poster.get(rad) ?? []), { konto: saldo.konto, belopp }]);
  }

  const rader = new Map<Foreningsrad, Rad>();
  for (const [rad, radposter] of poster) {
    rader.set(rad, {
      rad,
      belopp: sum(radposter.map((post) => post.belopp)),
      poster: radposter.sort((a, b) => Number(a.konto) - Number(b.konto)),
    });
  }
  const belopp = (rad: Foreningsrad): Ore => rader.get(rad)?.belopp ?? ZERO;
  const summa = (lista: readonly Foreningsrad[]): Ore => sum(lista.map(belopp));

  const summaIntakter = summa(INTAKTSRADER);
  const summaKostnader = summa(KOSTNADSRADER);
  const verksamhetensResultat = add(summaIntakter, summaKostnader);
  const resultatEfterFinansiellaPoster = add(
    add(verksamhetensResultat, belopp('finansiella_intakter')),
    belopp('finansiella_kostnader'),
  );
  const aretsResultat = add(
    add(resultatEfterFinansiellaPoster, belopp('bokslutsdispositioner')),
    belopp('skatt'),
  );

  const summaTillgangar = summa(TILLGANGSRADER);
  const summaSkulder = summa(SKULDRADER);
  const summaEgetKapital = add(
    add(summaTillgangar, negate(summaSkulder)),
    negate(belopp('obeskattade_reserver')),
  );

  return {
    rader,
    summaIntakter,
    summaKostnader,
    verksamhetensResultat,
    resultatEfterFinansiellaPoster,
    aretsResultat,
    summaTillgangar,
    balanseratResultat: add(summaEgetKapital, negate(aretsResultat)),
    summaEgetKapital,
    summaSkulder,
    summaEgetKapitalOchSkulder: add(
      add(summaEgetKapital, belopp('obeskattade_reserver')),
      summaSkulder,
    ),
    kontonUtanRad: utanRad.sort((a, b) => Number(a.konto) - Number(b.konto)),
  };
}

/**
 * A post may be left out when it has nothing to show, in either year
 * (kapitel 5: "en rubrik, post eller summeringsrad får utelämnas om det inte
 * finns något att redovisa"). Comparatives are required for every post that
 * is shown, so a post with an amount in only one of the years stays.
 */
export function harInnehall(
  rad: Foreningsrad,
  aret: Foreningsbokslut,
  foregaende: Foreningsbokslut | undefined,
): boolean {
  return (
    (aret.rader.get(rad)?.belopp ?? ZERO) !== ZERO ||
    (foregaende?.rader.get(rad)?.belopp ?? ZERO) !== ZERO
  );
}
