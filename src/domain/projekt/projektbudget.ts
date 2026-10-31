import { add, negate, sum, type Ore } from '../belopp/ore';
import type { Kontonummer } from '../konto/konto';
import type { Projektutdrag } from './projektutdrag';

/** One account: what was budgeted, what came of it, and what is left. */
export interface Budgetrad {
  readonly konto: Kontonummer;
  readonly budget: Ore;
  readonly utfall: Ore;
  /** Budget less outcome. Negative when the outcome went past the budget. */
  readonly kvar: Ore;
}

export interface Budgetsumma {
  readonly budget: Ore;
  readonly utfall: Ore;
  readonly kvar: Ore;
}

/** A project's budget against what has been booked on it. */
export interface Budgetjamforelse {
  readonly intakter: readonly Budgetrad[];
  readonly summaIntakter: Budgetsumma;
  readonly kostnader: readonly Budgetrad[];
  readonly summaKostnader: Budgetsumma;
  /**
   * Income less cost, budgeted and actual. Financial items are left out of both,
   * as a project budget has none.
   */
  readonly resultat: { readonly budget: Ore; readonly utfall: Ore };
}

/**
 * Sets a project's budget against its outcome.
 *
 * An account with an outcome and no budget is listed with a budget of nothing
 * rather than left out, since a cost nobody planned for is exactly what the
 * comparison is read for; an account with a budget and no outcome yet is listed
 * with nothing spent. The budget is for the whole project, so the statement
 * given is expected to be the whole of it and not one year.
 */
export function budgetMotUtfall(utdrag: Projektutdrag): Budgetjamforelse {
  const budget = utdrag.projekt.budget ?? [];
  const rad = (
    konton: ReadonlySet<Kontonummer>,
    utfall: ReadonlyMap<Kontonummer, Ore>,
    plats: (konto: Kontonummer) => boolean,
  ): Budgetrad[] =>
    [...konton]
      .filter(plats)
      .sort((a, b) => a.localeCompare(b))
      .map((konto) => {
        const planerat =
          budget.find((post) => post.konto === konto)?.belopp ?? (0 as Ore);
        const faktiskt = utfall.get(konto) ?? (0 as Ore);
        return {
          konto,
          budget: planerat,
          utfall: faktiskt,
          kvar: add(planerat, negate(faktiskt)),
        };
      });

  const intaktsutfall = new Map(utdrag.intakter.map((post) => [post.konto, post.belopp]));
  const kostnadsutfall = new Map(
    utdrag.kostnader.map((post) => [post.konto, post.belopp]),
  );
  const allaKonton = new Set<Kontonummer>([
    ...budget.map((post) => post.konto),
    ...intaktsutfall.keys(),
    ...kostnadsutfall.keys(),
  ]);

  const intakter = rad(allaKonton, intaktsutfall, (konto) => konto.startsWith('3'));
  const kostnader = rad(allaKonton, kostnadsutfall, (konto) => /^[4-7]/.test(konto));
  const summera = (rader: readonly Budgetrad[]): Budgetsumma => ({
    budget: sum(rader.map((post) => post.budget)),
    utfall: sum(rader.map((post) => post.utfall)),
    kvar: sum(rader.map((post) => post.kvar)),
  });
  const summaIntakter = summera(intakter);
  const summaKostnader = summera(kostnader);

  return {
    intakter,
    summaIntakter,
    kostnader,
    summaKostnader,
    resultat: {
      budget: add(summaIntakter.budget, negate(summaKostnader.budget)),
      utfall: add(summaIntakter.utfall, negate(summaKostnader.utfall)),
    },
  };
}
