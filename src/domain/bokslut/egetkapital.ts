import { add, isZero, negate, sum, type Ore } from '../belopp/ore';
import { kontonummer, type Kontonummer } from '../konto/konto';
import type { Ingaendebalans } from '../rakenskapsar/rakenskapsar';
import type { Kontering } from '../verifikat/verifikat';
import { placeringForKonto } from './forenkladArsbokslut';

/**
 * Eget kapital för en enskild firma, sammanställt som en förändring över
 * året i stället för bara ett saldo (BFN K1 punkt 6.66 definierar det som
 * skillnaden mellan tillgångar och skulder - det här är samma tal, brutet
 * ner på vad som faktiskt förändrade det).
 *
 * Uttag minskar eget kapital eftersom pengarna lämnar företaget utan att
 * vara en kostnad; en insättning ökar det utan att vara en intäkt - ingetdera
 * påverkar årets resultat, bara vem som äger pengarna.
 */
export function beraknaUtgaendeEgetKapital(
  ibEgetKapital: Ore,
  uttagIAr: Ore,
  insattningarIAr: Ore,
  aretsResultat: Ore,
): Ore {
  return add(add(add(ibEgetKapital, negate(uttagIAr)), insattningarIAr), aretsResultat);
}

/** BAS K1 2018: 8999 Årets resultat, bokslutskontot resultatet flyttas via. */
export const ARETS_RESULTAT_KONTO = kontonummer('8999');

/** BAS K1 2018: 2019 Årets resultat, delägare 1. */
export const ARETS_RESULTAT_EGET_KAPITAL_KONTO = kontonummer('2019');

/**
 * The rows that move the year's result from the result accounts onto eget
 * kapital, the way other bookkeeping programs do it (8999 mot 2019) - beslut
 * 2026-09-13 att göra likadant i Kontera.
 *
 * `forenkladArsbokslut.ts` needs no such entry: R11 and B10 come out the
 * same whether or not it exists, because B10 always adds in whatever part
 * of the result sits unbooked on the result accounts (see
 * `resultatEjOverfortTillEgetKapital`). This is booked anyway so that 2019's
 * own saldo, and a huvudbok or SIE export read on its own, show the year's
 * result without relying on that computation - and so that Kontera's
 * böcker look like every other program's when someone compares them.
 *
 * Not a money movement: nothing leaves the firm, so `resultat` is exactly
 * what `resultatEnligtBokforingen` says, positive for a profit, and the two
 * rows always sum to zero.
 */
export function resultatoverforingKonteringar(resultat: Ore): Kontering[] {
  return [
    { konto: ARETS_RESULTAT_KONTO, belopp: resultat },
    { konto: ARETS_RESULTAT_EGET_KAPITAL_KONTO, belopp: negate(resultat) },
  ];
}

/** True for a verifikat shaped like {@link resultatoverforingKonteringar}'s rows. */
export function arResultatoverforing(konteringar: readonly Kontering[]): boolean {
  return (
    konteringar.length === 2 &&
    konteringar.some((rad) => rad.konto === ARETS_RESULTAT_KONTO) &&
    konteringar.some((rad) => rad.konto === ARETS_RESULTAT_EGET_KAPITAL_KONTO)
  );
}

/**
 * BAS K1 2018: 2010 Eget kapital, delägare 1 - kontot varje annat
 * eget-kapital-underkonto (2012 skattekontot, 2013 egna uttag, 2017 egna
 * insättningar, 2019 årets resultat, ...) samlas i vid årsskiftet.
 */
export const EGET_KAPITAL_HUVUDKONTO = kontonummer('2010');

/** An eget-kapital-account that is not the huvudkonto itself. */
export function arEgetKapitalUnderkonto(konto: Kontonummer): boolean {
  return (
    konto !== EGET_KAPITAL_HUVUDKONTO && placeringForKonto(konto)?.typ === 'eget-kapital'
  );
}

/**
 * True for a verifikat shaped like {@link omforingAvEgetKapitalUnderkonton}'s
 * rows: every line is either the huvudkonto or an underkonto, and the
 * huvudkonto is one of them. Lets a repeat click of the button that books
 * this recognise an omföring already booked for the year instead of
 * doubling it.
 */
export function arEgetKapitalomforing(konteringar: readonly Kontering[]): boolean {
  return (
    konteringar.length >= 2 &&
    konteringar.some((rad) => rad.konto === EGET_KAPITAL_HUVUDKONTO) &&
    konteringar.every(
      (rad) =>
        rad.konto === EGET_KAPITAL_HUVUDKONTO || arEgetKapitalUnderkonto(rad.konto),
    )
  );
}

/**
 * The rows that fold every 20xx-underkontos ingående balans into 2010 on
 * det nya årets första dag - samma praxis som i andra program (8999/2019
 * den 31/12, 2011-2019 mot 2010 den 1/1, beslut 2026-09-13).
 *
 * Utan detta skulle uttag, insättningar, skattekontot och årets resultat
 * växa sig stora på sina egna konton över flera år i stället för att samlas
 * i den löpande kapitalposten - och 2010 är den enda av dem som ska bära ett
 * saldo från ett år till nästa. Ingen pengarörelse, ingen påverkan på
 * resultatet: bara en flytt av det saldo bokföringen redan har.
 *
 * Tomt när inget underkonto har ett saldo att flytta - se
 * {@link arEgetKapitalUnderkonto}.
 */
export function omforingAvEgetKapitalUnderkonton(
  ingaendeBalanser: readonly Ingaendebalans[],
): Kontering[] {
  const underkonton = ingaendeBalanser.filter(
    (post) => arEgetKapitalUnderkonto(post.konto) && !isZero(post.belopp),
  );
  if (underkonton.length === 0) {
    return [];
  }
  return [
    ...underkonton.map((post) => ({ konto: post.konto, belopp: negate(post.belopp) })),
    {
      konto: EGET_KAPITAL_HUVUDKONTO,
      belopp: sum(underkonton.map((post) => post.belopp)),
    },
  ];
}
