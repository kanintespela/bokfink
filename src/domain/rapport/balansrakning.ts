import { add, negate, ZERO, type Ore } from '../belopp/ore';
import { kontoklass, type Konto, type Kontonummer } from '../konto/konto';
import { aretsResultat } from './resultatrakning';
import type { Kontosaldo } from './saldon';

/**
 * The balance sheet: what the business owns, and who has a claim on it.
 *
 * Grouped by the BAS chart's own kontogrupper, which is where the standard
 * headings come from: 10-13 are fixed assets, 14-19 current ones, 20 is
 * equity and 21-29 the debts. The förenklade årsbokslutet's form is a
 * different report for a different purpose and belongs to the bokslut.
 *
 * Both sides are shown positive. Assets are debited and read positive in the
 * ledger already; equity and debt are credited and would read negative, so
 * that side is negated once - which is also what makes the two sides
 * comparable at a glance rather than by sign.
 */
export interface Balansrakning {
  readonly tillgangar: readonly Balansgrupp[];
  readonly summaTillgangar: Ore;
  readonly egetKapitalOchSkulder: readonly Balansgrupp[];
  /**
   * The result so far, which is part of the equity but not yet booked into
   * it.
   *
   * The result accounts are closed into eget kapital at the bokslut and not
   * before, so a balance sheet drawn during the year only balances with this
   * line in it. Shown separately rather than folded in, because that is what
   * it is: this year's outcome, not last year's capital.
   */
  readonly aretsResultat: Ore;
  readonly summaEgetKapitalOchSkulder: Ore;
  /**
   * What the two sides differ by. Zero in a sound set of books.
   *
   * Present rather than asserted: hard rule 11 says a broken figure has to be
   * visible, and a balance sheet that does not balance is the clearest signal
   * a ledger can give that something is wrong with it.
   */
  readonly differens: Ore;
}

export interface Balansgrupp {
  readonly rubrik: string;
  readonly poster: readonly Balanspost[];
  readonly summa: Ore;
}

export interface Balanspost {
  readonly konto: Kontonummer;
  readonly namn: string;
  readonly belopp: Ore;
}

/** BAS kontogrupper, and the headings a balance sheet gives them. */
const TILLGANGAR: readonly Avsnitt[] = [
  { fran: 1000, till: 1399, rubrik: 'Anläggningstillgångar' },
  { fran: 1400, till: 1499, rubrik: 'Varulager' },
  { fran: 1500, till: 1799, rubrik: 'Fordringar' },
  { fran: 1800, till: 1999, rubrik: 'Kassa och bank' },
];

const SKULDER: readonly Avsnitt[] = [
  { fran: 2000, till: 2099, rubrik: 'Eget kapital' },
  { fran: 2100, till: 2299, rubrik: 'Obeskattade reserver och avsättningar' },
  { fran: 2300, till: 2399, rubrik: 'Långfristiga skulder' },
  { fran: 2400, till: 2999, rubrik: 'Kortfristiga skulder' },
];

interface Avsnitt {
  readonly fran: number;
  readonly till: number;
  readonly rubrik: string;
}

/** Builds the report from a period's balances, read at the period's end. */
export function beraknaBalansrakning(
  saldon: ReadonlyMap<Kontonummer, Kontosaldo>,
  konton: ReadonlyMap<Kontonummer, Konto>,
): Balansrakning {
  const tillgangar = grupper(saldon, konton, TILLGANGAR, false);
  const skulder = grupper(saldon, konton, SKULDER, true);

  const summaTillgangar = summera(tillgangar);
  const resultat = aretsResultatIPerioden(saldon);
  const summaSkulder = add(summera(skulder), resultat);

  return {
    tillgangar,
    summaTillgangar,
    egetKapitalOchSkulder: skulder,
    aretsResultat: resultat,
    summaEgetKapitalOchSkulder: summaSkulder,
    differens: add(summaTillgangar, negate(summaSkulder)),
  };
}

/**
 * The result the balance sheet has to carry.
 *
 * Everything the result accounts have moved during the year up to this point,
 * not only during the period being reported: a balance sheet is a position on
 * a date, and the position includes January even when the report is about
 * March.
 */
function aretsResultatIPerioden(saldon: ReadonlyMap<Kontonummer, Kontosaldo>): Ore {
  const helaAret = new Map<Kontonummer, Kontosaldo>();
  for (const saldo of saldon.values()) {
    helaAret.set(saldo.konto, {
      ...saldo,
      forandring: add(saldo.ingaende, saldo.forandring),
    });
  }
  return aretsResultat(helaAret);
}

function grupper(
  saldon: ReadonlyMap<Kontonummer, Kontosaldo>,
  konton: ReadonlyMap<Kontonummer, Konto>,
  avsnitt: readonly Avsnitt[],
  kreditsida: boolean,
): Balansgrupp[] {
  const ut: Balansgrupp[] = [];

  for (const { fran, till, rubrik } of avsnitt) {
    const poster = [...saldon.values()]
      .filter((saldo) => {
        const nummer = Number(saldo.konto);
        return nummer >= fran && nummer <= till && saldo.utgaende !== 0;
      })
      .map((saldo) => ({
        konto: saldo.konto,
        namn: konton.get(saldo.konto)?.namn ?? '',
        belopp: kreditsida ? negate(saldo.utgaende) : saldo.utgaende,
      }))
      .sort((a, b) => a.konto.localeCompare(b.konto));

    if (poster.length > 0) {
      ut.push({
        rubrik,
        poster,
        summa: poster.reduce((total, rad) => add(total, rad.belopp), ZERO),
      });
    }
  }

  return ut;
}

function summera(grupper: readonly Balansgrupp[]): Ore {
  return grupper.reduce((total, grupp) => add(total, grupp.summa), ZERO);
}

/** True for the accounts a balance sheet reports at all. */
export function arBalansrad(konto: Kontonummer): boolean {
  return kontoklass(konto) <= 2;
}
