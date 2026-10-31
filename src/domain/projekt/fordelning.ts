import { add, negate, ZERO, type Ore } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import { kontoklass, type Kontonummer } from '../konto/konto';
import { inomIntervall } from '../tid/datum';
import type { BokfortVerifikat, Kontering } from '../verifikat/verifikat';
import type { Projektperiod } from './projektutdrag';

/**
 * What one cost account came to in a period, and how much of it is on a project.
 *
 * `utanProjekt` is the common cost: what is left to share out among projects.
 */
export interface Kostnadsfordelning {
  readonly konto: Kontonummer;
  readonly totalt: Ore;
  readonly medProjekt: Ore;
  readonly utanProjekt: Ore;
  /** The part on each project, for the projects that have any. */
  readonly perProjekt: ReadonlyMap<Uuid, Ore>;
}

/** Whether an account is one a cost is shared out on: classes 4-7, the cost accounts. */
export function arKostnadskonto(konto: Kontonummer): boolean {
  const klass = kontoklass(konto);
  return klass >= 4 && klass <= 7;
}

/**
 * The cost accounts of a period, each with what is on projects and what is not.
 *
 * Only accounts that came to something are listed. A cost that was moved onto a
 * project and back leaves the account where it was, and a reversal carries the
 * project of what it reverses, so neither shows up as common cost it was not.
 */
export function kostnaderPerKonto(
  verifikat: Iterable<BokfortVerifikat>,
  period: Projektperiod,
): Kostnadsfordelning[] {
  const perKonto = new Map<Kontonummer, { totalt: Ore; perProjekt: Map<Uuid, Ore> }>();
  for (const post of verifikat) {
    if (!inomIntervall(post.datum, period.start, period.slut)) {
      continue;
    }
    for (const rad of post.konteringar) {
      if (!arKostnadskonto(rad.konto)) {
        continue;
      }
      const konto = perKonto.get(rad.konto) ?? { totalt: ZERO, perProjekt: new Map() };
      konto.totalt = add(konto.totalt, rad.belopp);
      if (rad.projekt !== undefined) {
        konto.perProjekt.set(
          rad.projekt,
          add(konto.perProjekt.get(rad.projekt) ?? ZERO, rad.belopp),
        );
      }
      perKonto.set(rad.konto, konto);
    }
  }

  return [...perKonto]
    .map(([konto, { totalt, perProjekt }]) => {
      const medProjekt = [...perProjekt.values()].reduce(
        (summa, belopp) => add(summa, belopp),
        ZERO,
      );
      return {
        konto,
        totalt,
        medProjekt,
        utanProjekt: add(totalt, negate(medProjekt)),
        perProjekt: new Map([...perProjekt].filter(([, belopp]) => belopp !== 0)),
      };
    })
    .filter((post) => post.totalt !== 0 || post.medProjekt !== 0)
    .sort((a, b) => a.konto.localeCompare(b.konto));
}

export type Fordelningsriktning =
  /** From the common cost on the account onto a project. */
  | 'till_projekt'
  /** From a project back to the common cost. */
  | 'fran_projekt';

/**
 * The rows that move an amount between "no project" and a project on one account.
 *
 * Two rows on the same account, one on each side, so the account comes to what
 * it did before and the verifikat balances, while the project's cost goes up or
 * down by the amount. Nothing is booked on another account: sharing out is not
 * a purchase, so it has no moms and reaches no box of a momsdeklaration.
 */
export function fordelningsKonteringar(uppgifter: {
  readonly konto: Kontonummer;
  readonly belopp: Ore;
  readonly projekt: Uuid;
  readonly riktning: Fordelningsriktning;
}): Kontering[] {
  const { konto, belopp, projekt, riktning } = uppgifter;
  if (!arKostnadskonto(konto)) {
    throw new RangeError(
      `Konto ${konto} är inte ett kostnadskonto. Bara kostnader i kontoklass 4–7 fördelas på projekt.`,
    );
  }
  if (belopp <= 0) {
    throw new RangeError('Beloppet som flyttas måste vara större än noll.');
  }
  return riktning === 'till_projekt'
    ? [
        { konto, belopp, projekt },
        { konto, belopp: negate(belopp) },
      ]
    : [
        { konto, belopp },
        { konto, belopp: negate(belopp), projekt },
      ];
}
