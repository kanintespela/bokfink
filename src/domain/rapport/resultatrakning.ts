import { add, negate, ZERO, type Ore } from '../belopp/ore';
import { kontoklass, type Konto, type Kontonummer } from '../konto/konto';
import type { Kontosaldo } from './saldon';

/**
 * The income statement: what came in, what went out, and what is left.
 *
 * Grouped the way the BAS chart is built rather than the way the förenklade
 * årsbokslutet's form is - that form belongs to the bokslut in stage 8, and
 * this report answers a different question: how is the year going. The
 * grouping therefore follows the account classes, which is what every
 * bookkeeping system shows and what the account numbers already say.
 *
 * Signs follow the convention a Swedish resultaträkning is printed with:
 * income positive, costs negative, and the sum of the column is the result.
 * In the ledger it is the other way round - a cost is debited and an income
 * credited - so every line is negated exactly once, here, and the arithmetic
 * needs no special cases afterwards.
 */
export interface Resultatrakning {
  readonly grupper: readonly Resultatgrupp[];
  /** Income less operating costs, before financial items. */
  readonly rorelseresultat: Ore;
  readonly finansiellaPoster: Ore;
  /** Positive is a profit. */
  readonly aretsResultat: Ore;
}

export interface Resultatgrupp {
  readonly rubrik: string;
  readonly poster: readonly Resultatpost[];
  readonly summa: Ore;
}

export interface Resultatpost {
  readonly konto: Kontonummer;
  readonly namn: string;
  readonly belopp: Ore;
}

/**
 * The classes, and what they are called in a report.
 *
 * Class 8 is missing on purpose: it holds financial income and financial
 * costs side by side and cannot be split by number, so it is placed by each
 * account's own type further down.
 */
const RUBRIKER: readonly {
  readonly klasser: readonly number[];
  readonly rubrik: string;
}[] = [
  { klasser: [3], rubrik: 'Rörelsens intäkter' },
  { klasser: [4], rubrik: 'Varor, material och tjänster' },
  { klasser: [5, 6], rubrik: 'Övriga externa kostnader' },
  { klasser: [7], rubrik: 'Personal och avskrivningar' },
];

/**
 * Builds the report from a period's balances.
 *
 * Only the period's own movement counts. A result account's opening figure is
 * what the year had accumulated before the period, which belongs in a
 * comparison rather than in this report's own sums.
 */
export function beraknaResultatrakning(
  saldon: ReadonlyMap<Kontonummer, Kontosaldo>,
  konton: ReadonlyMap<Kontonummer, Konto>,
): Resultatrakning {
  const grupper: Resultatgrupp[] = [];
  let rorelse = ZERO;

  for (const { klasser, rubrik } of RUBRIKER) {
    const poster = [...saldon.values()]
      .filter((saldo) => klasser.includes(kontoklass(saldo.konto)))
      .filter((saldo) => saldo.forandring !== 0)
      .map((saldo) => post(saldo, konton))
      .sort((a, b) => a.konto.localeCompare(b.konto));

    if (poster.length === 0) {
      continue;
    }
    const summa = poster.reduce((total, rad) => add(total, rad.belopp), ZERO);
    grupper.push({ rubrik, poster, summa });
    rorelse = add(rorelse, summa);
  }

  const finansiella = [...saldon.values()]
    .filter((saldo) => kontoklass(saldo.konto) === 8 && saldo.forandring !== 0)
    .map((saldo) => post(saldo, konton))
    .sort((a, b) => a.konto.localeCompare(b.konto));

  const finansiellaPoster = finansiella.reduce(
    (total, rad) => add(total, rad.belopp),
    ZERO,
  );
  if (finansiella.length > 0) {
    grupper.push({
      rubrik: 'Finansiella poster',
      poster: finansiella,
      summa: finansiellaPoster,
    });
  }

  return {
    grupper,
    rorelseresultat: rorelse,
    finansiellaPoster,
    aretsResultat: add(rorelse, finansiellaPoster),
  };
}

/**
 * The period's result, whatever the accounts are called.
 *
 * The same figure the report ends with, computed on its own because the
 * balansräkning needs it too - the books do not close the result accounts
 * until the year ends, so a balance sheet drawn before that only balances
 * with this line in it.
 */
export function aretsResultat(saldon: ReadonlyMap<Kontonummer, Kontosaldo>): Ore {
  let summa = ZERO;
  for (const saldo of saldon.values()) {
    const klass = kontoklass(saldo.konto);
    if (klass >= 3 && klass <= 8) {
      // Stored signs: income is credited and costs are debited, so their sum
      // is negative for a profit. Negated once, here, so that positive means
      // what everybody outside a ledger means by a profit.
      summa = add(summa, saldo.forandring);
    }
  }
  return negate(summa);
}

/**
 * One line, turned from ledger signs into report signs.
 *
 * One rule for every result account, which is why class 8 needs no special
 * handling here: financial income is credited and comes out positive,
 * financial cost is debited and comes out negative, without anyone having to
 * know which of the two an account is.
 */
function post(saldo: Kontosaldo, konton: ReadonlyMap<Kontonummer, Konto>): Resultatpost {
  return {
    konto: saldo.konto,
    namn: konton.get(saldo.konto)?.namn ?? '',
    belopp: negate(saldo.forandring),
  };
}
