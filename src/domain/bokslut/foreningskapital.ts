import { add, negate, sum, ZERO, type Ore } from '../belopp/ore';
import type { Kontonummer } from '../konto/konto';
import type { Ingaendebalans } from '../rakenskapsar/rakenskapsar';
import type { BokfortVerifikat, Kontering } from '../verifikat/verifikat';
import { arResultatoverforing, EGET_KAPITAL_HUVUDKONTO } from './egetkapital';
import { placeringForKonto } from './forenkladArsbokslut';

/**
 * Eget kapital för en ideell förening.
 *
 * BFNAR 2010:1 punkt 6.66: eget kapital är skillnaden mellan föreningens
 * tillgångar och summan av dess skulder och obeskattade reserver. Punkt 6.67:
 * reserverade medel för specifika ändamål är en del av eget kapital, och en
 * reservering ska inte påverka resultaträkningen. Bilaga 2 har bara två rader
 * under eget kapital - balanserat över-/underskott och årets över-/underskott
 * - så de reserverade medlen står inom det balanserade, och visas här som en
 * uppdelning av det.
 *
 * En förening har ingen ägare som tar ut eller sätter in pengar, så till
 * skillnad från en enskild firma (egetkapital.ts) finns här inga uttag och
 * insättningar att hålla isär. Kapitalet ändras av årets resultat och av det
 * som bokförts direkt på kapitalkontona.
 *
 * Alla tal har eget kapitals tecken: positivt är kapital, ett positivt
 * resultat är ett överskott. Huvudboken har det omvänt, eftersom kapital står
 * på kreditsidan.
 */
export interface Reserveradepost {
  readonly konto: Kontonummer;
  readonly ingaende: Ore;
  readonly utgaende: Ore;
}

export interface Foreningskapital {
  readonly ingaende: Ore;
  readonly aretsResultat: Ore;
  /** Utgående kapital före årets resultat: bilaga 2:s "balanserat över-/underskott". */
  readonly balanserat: Ore;
  readonly utgaende: Ore;
  readonly reserverade: readonly Reserveradepost[];
  readonly summaReserverat: Ore;
  /** What is not reserved for a purpose; negative when more is reserved than there is. */
  readonly fritt: Ore;
}

/**
 * The accounts a reservation can sit on: inside the eget kapital range of the
 * kontoplan, apart from 2010 (balanserat) and 2011-2019, which hold the
 * capital the reservation is taken from and the year's result.
 */
export const FORSTA_RESERVERINGSKONTO = 2020;
export const SISTA_RESERVERINGSKONTO = 2049;

export function arReserveringskonto(konto: Kontonummer): boolean {
  const nummer = Number(konto);
  return (
    nummer >= FORSTA_RESERVERINGSKONTO &&
    nummer <= SISTA_RESERVERINGSKONTO &&
    placeringForKonto(konto)?.typ === 'eget-kapital'
  );
}

function arKapitalkonto(konto: Kontonummer): boolean {
  return placeringForKonto(konto)?.typ === 'eget-kapital';
}

/**
 * The year's capital, from the opening balances and what was booked.
 *
 * `resultat` is the year's result as the books have it, with 8990-8999 left
 * out (see `resultatEnligtBokforingen`), so it is the same whether or not it
 * has been transferred onto the capital accounts. That transfer is left out
 * of the movement here for the same reason - counting it as well as the
 * result would count the year's result twice.
 *
 * A verifikat and its annullering both count, and cancel each other.
 */
export function beraknaForeningskapital({
  ingaendeBalanser,
  verifikat,
  reserveradeKonton,
  resultat,
}: {
  readonly ingaendeBalanser: readonly Ingaendebalans[];
  readonly verifikat: readonly BokfortVerifikat[];
  readonly reserveradeKonton: readonly Kontonummer[];
  readonly resultat: Ore;
}): Foreningskapital {
  const ingaende = negate(
    sum(
      ingaendeBalanser
        .filter((post) => arKapitalkonto(post.konto))
        .map((post) => post.belopp),
    ),
  );

  const rorelser = verifikat
    .filter((post) => !arResultatoverforing(post.konteringar))
    .flatMap((post) => post.konteringar);
  const direkt = negate(
    sum(rorelser.filter((rad) => arKapitalkonto(rad.konto)).map((rad) => rad.belopp)),
  );

  const reserverade = [...new Set(reserveradeKonton)]
    .sort((a, b) => Number(a) - Number(b))
    .map((konto): Reserveradepost => {
      const ib = negate(
        sum(
          ingaendeBalanser
            .filter((post) => post.konto === konto)
            .map((post) => post.belopp),
        ),
      );
      const ror = negate(
        sum(
          verifikat
            .flatMap((post) => post.konteringar)
            .filter((rad) => rad.konto === konto)
            .map((rad) => rad.belopp),
        ),
      );
      return { konto, ingaende: ib, utgaende: add(ib, ror) };
    });
  const summaReserverat = sum(reserverade.map((post) => post.utgaende));

  const utgaende = add(add(ingaende, resultat), direkt);
  return {
    ingaende,
    aretsResultat: resultat,
    balanserat: add(utgaende, negate(resultat)),
    utgaende,
    reserverade,
    summaReserverat,
    fritt: add(utgaende, negate(summaReserverat)),
  };
}

export type Reserveringsriktning = 'reservera' | 'frigor';

/**
 * The rows that move capital onto or off a purpose.
 *
 * Within eget kapital, so nothing leaves the förening and no result account is
 * touched (6.67). Taken from 2010 - the balanserade kapital - because that
 * is where the capital the association has not set aside is kept.
 */
export function reserveringKonteringar(
  fond: Kontonummer,
  belopp: Ore,
  riktning: Reserveringsriktning,
): Kontering[] {
  if (belopp <= ZERO) {
    throw new RangeError('Beloppet att reservera eller frigöra ska vara större än noll.');
  }
  if (!arReserveringskonto(fond)) {
    throw new RangeError(
      `Konto ${fond} kan inte ta reserverade medel. Använd ett konto mellan ` +
        `${FORSTA_RESERVERINGSKONTO} och ${SISTA_RESERVERINGSKONTO}.`,
    );
  }
  return riktning === 'reservera'
    ? [
        { konto: EGET_KAPITAL_HUVUDKONTO, belopp },
        { konto: fond, belopp: negate(belopp) },
      ]
    : [
        { konto: fond, belopp },
        { konto: EGET_KAPITAL_HUVUDKONTO, belopp: negate(belopp) },
      ];
}
