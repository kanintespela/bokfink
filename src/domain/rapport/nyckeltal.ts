import { add, negate, ZERO, type Ore } from '../belopp/ore';
import type { Konto, Kontonummer } from '../konto/konto';
import type { Rakenskapsar } from '../rakenskapsar/rakenskapsar';
import { datumAv, delar, sistaIManaden } from '../tid/datum';
import type { BokfortVerifikat } from '../verifikat/verifikat';
import { aretsResultat } from './resultatrakning';
import { beraknaPeriodsaldon, type Kontosaldo } from './saldon';

/**
 * The four figures a year is judged by, and the series behind them.
 *
 * Deliberately few. A page of numbers is read as a page of numbers, and the
 * questions someone running a one-person firm actually asks are: am I making
 * anything, is there money in the account, what does it go to, and what do I
 * owe Skatteverket. Everything here answers one of those.
 *
 * Every figure is derived from the same balances the reports are built on, so
 * a key figure cannot disagree with the resultaträkning it summarises.
 */

/** BAS accounts holding money that can be spent today. */
const LIKVIDA = { fran: 1900, till: 1999 };

/** BAS accounts carrying VAT to or from Skatteverket. */
const MOMS = { fran: 2600, till: 2699 };

export interface Manadsvarde {
  /** The month as YYYY-MM, which sorts and reads as itself. */
  readonly manad: string;
  readonly belopp: Ore;
}

/**
 * The result of each month in a fiscal year.
 *
 * Each month on its own, not accumulated: the question a bar chart answers is
 * which months carried the year, and a rising line of totals hides exactly
 * that.
 */
export function resultatPerManad(
  ar: Rakenskapsar,
  verifikat: readonly BokfortVerifikat[],
): Manadsvarde[] {
  return manader(ar).map(({ manad, fran, till }) => ({
    manad,
    belopp: aretsResultat(beraknaPeriodsaldon(ar, verifikat, fran, till)),
  }));
}

/**
 * What was in the bank and the till at the end of each month.
 *
 * A position rather than a movement, so each month carries everything before
 * it - which is what makes the line answer "did I run out in July".
 */
export function likviditetPerManad(
  ar: Rakenskapsar,
  verifikat: readonly BokfortVerifikat[],
): Manadsvarde[] {
  return manader(ar).map(({ manad, fran, till }) => ({
    manad,
    belopp: likvidaMedel(beraknaPeriodsaldon(ar, verifikat, fran, till)),
  }));
}

/** Money that can be spent today: the closing balance of the 19-accounts. */
export function likvidaMedel(saldon: ReadonlyMap<Kontonummer, Kontosaldo>): Ore {
  return summeraInom(saldon, LIKVIDA, (saldo) => saldo.utgaende);
}

/**
 * What is owed to Skatteverket in VAT, as the ledger stands.
 *
 * Output VAT is credited and input VAT debited, so their sum is negative when
 * something is owed. Negated once, here, so that a positive figure means what
 * the words "momsskuld" mean. Negative is money to come back.
 */
export function momsskuld(saldon: ReadonlyMap<Kontonummer, Kontosaldo>): Ore {
  return negate(summeraInom(saldon, MOMS, (saldo) => saldo.utgaende));
}

export interface Kostnadspost {
  readonly konto: Kontonummer;
  readonly namn: string;
  /** Positive: what the account cost during the period. */
  readonly belopp: Ore;
}

/**
 * Where the money went, largest first.
 *
 * Accounts rather than groups, because that is the level the person chose
 * when they made the templates - "Drivmedel" is a line they recognise, while
 * "kontogrupp 56" is not. Everything below the largest few is gathered into
 * one line rather than dropped: a chart whose parts do not add up to the
 * whole is a chart that lies.
 */
export function kostnadsfordelning(
  saldon: ReadonlyMap<Kontonummer, Kontosaldo>,
  konton: ReadonlyMap<Kontonummer, Konto>,
  hogst = 6,
): Kostnadspost[] {
  const kostnader = [...saldon.values()]
    .filter((saldo) => {
      const nummer = Number(saldo.konto);
      return nummer >= 4000 && nummer <= 7999 && saldo.forandring > 0;
    })
    .map((saldo) => ({
      konto: saldo.konto,
      namn: konton.get(saldo.konto)?.namn ?? '',
      belopp: saldo.forandring,
    }))
    .sort((a, b) => b.belopp - a.belopp);

  if (kostnader.length <= hogst) {
    return kostnader;
  }

  const ovriga = kostnader.slice(hogst - 1);
  return [
    ...kostnader.slice(0, hogst - 1),
    {
      konto: '' as Kontonummer,
      namn: `Övriga ${ovriga.length} konton`,
      belopp: ovriga.reduce((summa, post) => add(summa, post.belopp), ZERO),
    },
  ];
}

function summeraInom(
  saldon: ReadonlyMap<Kontonummer, Kontosaldo>,
  intervall: { readonly fran: number; readonly till: number },
  las: (saldo: Kontosaldo) => Ore,
): Ore {
  let summa = ZERO;
  for (const saldo of saldon.values()) {
    const nummer = Number(saldo.konto);
    if (nummer >= intervall.fran && nummer <= intervall.till) {
      summa = add(summa, las(saldo));
    }
  }
  return summa;
}

/** The months a fiscal year covers, whatever month it starts in. */
function manader(ar: Rakenskapsar) {
  const start = delar(ar.start);
  const ut: {
    manad: string;
    fran: ReturnType<typeof datumAv>;
    till: ReturnType<typeof datumAv>;
  }[] = [];

  for (let steg = 0; steg < 12; steg += 1) {
    const manadsnummer = start.manad + steg;
    const artal = start.ar + Math.floor((manadsnummer - 1) / 12);
    const iAret = ((manadsnummer - 1) % 12) + 1;
    const fran = datumAv(artal, iAret, 1);
    if (fran > ar.slut) {
      break;
    }
    ut.push({
      manad: `${artal}-${String(iAret).padStart(2, '0')}`,
      fran,
      till: sistaIManaden(fran),
    });
  }

  return ut;
}
