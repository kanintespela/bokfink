import {
  beraknaUtgaendeEgetKapital,
  resultatoverforingKonteringar,
} from '../domain/bokslut/egetkapital';
import {
  beraknaForenkladArsbokslut,
  placeringForKonto,
} from '../domain/bokslut/forenkladArsbokslut';
import { add, isZero, negate, ZERO, type Ore } from '../domain/belopp/ore';
import type { Kontonummer } from '../domain/konto/konto';
import { omfattar, type Rakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { beraknaSaldon } from '../domain/rapport/saldon';
import type { Datum } from '../domain/tid/datum';
import type { Verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast, type BokfortVerifikat } from '../domain/verifikat/verifikat';
import { lasTillstand } from './bokforing';
import type { KonteraDatabase } from './db';
import { bokforUtkast, nyttId, type Skrivkontext } from './kommandon';

export interface Egetkapitalsammanstallning {
  readonly ibEgetKapital: Ore;
  readonly uttagIAr: Ore;
  readonly insattningarIAr: Ore;
  readonly aretsResultat: Ore;
  readonly ubEgetKapital: Ore;
}

/**
 * Eget kapital för året, brutet ner på vad som förändrade det.
 *
 * Alla fem talen har eget kapitalets egna tecken, inte huvudbokens: ett
 * positivt ingående eller utgående belopp är kapital i firman, ett positivt
 * resultat är en vinst. Eget kapital står på kreditsidan, så de ingående
 * balanserna vänds en gång, här, precis som B10 vänder dem i det förenklade
 * årsbokslutet - och då är summan här samma tal som B10 för samma år.
 *
 * Årets resultat hämtas ur bokslutet i stället för att summeras ur
 * resultatkontona rakt av, eftersom konto 8990-8999 också är resultatkonton:
 * ett bokslutsverifikat som för över resultatet (8999 mot 2019, som
 * många programs SIE-filer gör) nollar summan av klass 3-8 utan att en krona har
 * lämnat firman. `resultatEnligtBokforingen` räknar bort överföringen och
 * ger därför samma resultat före som efter den. Det ingående kapitalet är
 * årets IB, och överföringen rör bara året, så inget dubbelräknas.
 *
 * `uttagInsattningKonton` är BAS K1:s 2013 Övriga egna uttag och 2017 Egna
 * insättningar. Äldre bokföringar bär båda riktningarna på 2013, så varje
 * konto räknas åt båda hållen - debet är ett uttag, kredit en insättning.
 * Kontosaldo (se saldon.ts) ger bara nettorörelsen, så de två hålls isär här
 * genom att summera varje kontering för sig, samma mönster som
 * berakningAvArsAvskrivning använder för att skilja inköp från avyttrat.
 */
export async function egetkapitalsammanstallning(
  db: KonteraDatabase,
  ar: Rakenskapsar,
  uttagInsattningKonton: readonly Kontonummer[],
): Promise<Egetkapitalsammanstallning> {
  const tillstand = await lasTillstand(db);
  const iAret = [...tillstand.verifikat.values()].filter((v) => omfattar(ar, v.datum));

  const ibEgetKapital = negate(
    ar.ingaendeBalanser
      .filter((post) => arEgetKapitalkonto(post.konto))
      .reduce((summa, post) => add(summa, post.belopp), ZERO),
  );

  /*
   * A verifikat and its annullering cancel out, and are left out together.
   * Counted row by row they did not: the reversal's debit on 2013 became an
   * uttag, and the mistake it reversed an insättning. Only a pair inside
   * the year is dropped - a reversal booked in a later year belongs to that
   * year's figures, as the original belongs to this one's.
   */
  const idIAret = new Set(iAret.map((verifikat) => verifikat.id));
  const annulleradeIAret = new Set(
    iAret.flatMap((verifikat) =>
      verifikat.annullerar !== undefined && idIAret.has(verifikat.annullerar)
        ? [verifikat.annullerar, verifikat.id]
        : [],
    ),
  );

  let uttagIAr = ZERO;
  let insattningarIAr = ZERO;
  for (const verifikat of iAret) {
    if (annulleradeIAret.has(verifikat.id)) {
      continue;
    }
    for (const rad of verifikat.konteringar) {
      if (!uttagInsattningKonton.includes(rad.konto)) {
        continue;
      }
      if (rad.belopp >= ZERO) {
        uttagIAr = add(uttagIAr, rad.belopp);
      } else {
        insattningarIAr = add(insattningarIAr, negate(rad.belopp));
      }
    }
  }

  const saldon = beraknaSaldon(ar.ingaendeBalanser, iAret);
  const resultat = beraknaForenkladArsbokslut(saldon).resultatEnligtBokforingen;

  return {
    ibEgetKapital,
    uttagIAr,
    insattningarIAr,
    aretsResultat: resultat,
    ubEgetKapital: beraknaUtgaendeEgetKapital(
      ibEgetKapital,
      uttagIAr,
      insattningarIAr,
      resultat,
    ),
  };
}

/**
 * Books the year's result over from the result accounts onto eget kapital,
 * the way many programs' SIE files do it - 8999 mot 2019, beslut 2026-09-13.
 *
 * K1's blankett needs no such entry (`forenkladArsbokslut.ts` computes R11
 * and B10 the same whether or not it exists), so this is booked for the
 * ledger's own sake: 2019's saldo, and a huvudbok read on its own, should
 * show the year's result rather than lean on that computation.
 *
 * The amount booked is `resultatEjOverfortTillEgetKapital` as the ledger
 * stands right now, not a stored figure - so a correction added to the year
 * after an earlier transfer books just the remaining difference rather than
 * duplicating what already moved. Refused when there is nothing left to
 * move, the same way `bokforLagerforandring` refuses no change.
 */
export async function bokforResultatoverforing(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  ar: Rakenskapsar,
  serie: Verifikatserie,
): Promise<BokfortVerifikat> {
  const tillstand = await lasTillstand(db);
  const iAret = [...tillstand.verifikat.values()].filter((v) => omfattar(ar, v.datum));
  const saldon = beraknaSaldon(ar.ingaendeBalanser, iAret);
  const resultat = beraknaForenkladArsbokslut(saldon).resultatEjOverfortTillEgetKapital;

  if (isZero(resultat)) {
    throw new Error(
      'Hela årets resultat är redan fört till eget kapital. Det finns inget kvar att flytta.',
    );
  }

  const utkast = skapaUtkast({
    id: nyttId(kontext),
    datum: ar.slut,
    beskrivning: 'Årets resultat',
    konteringar: resultatoverforingKonteringar(resultat),
  });
  return bokforUtkast(db, kontext, utkast, serie);
}

/**
 * Samma konton som B10 räknar som eget kapital, hämtat ur samma tabell.
 *
 * BAS lägger 2050-2099 på upplysningsraderna U1-U4 och utjämningskontot
 * 2090, inte i eget kapital, så intervallet kan inte skrivas som 2000-2099
 * här utan att sammanställningen börjar avvika från bokslutet.
 */
function arEgetKapitalkonto(konto: Kontonummer): boolean {
  return placeringForKonto(konto)?.typ === 'eget-kapital';
}

/**
 * Books a raw eget uttag or egen insättning: money crossing the line between
 * the företag and its innehavare with no cost or income attached (an
 * enskild firma has no lön to itself). `belopp` is always positive; which
 * side is debited follows from `typ`.
 */
export async function bokforEgetUttagInsattning(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  datum: Datum,
  serie: Verifikatserie,
  typ: 'uttag' | 'insattning',
  betalkonto: Kontonummer,
  uttagInsattningKonto: Kontonummer,
  belopp: Ore,
): Promise<BokfortVerifikat> {
  const konteringar =
    typ === 'uttag'
      ? [
          { konto: uttagInsattningKonto, belopp },
          { konto: betalkonto, belopp: negate(belopp) },
        ]
      : [
          { konto: betalkonto, belopp },
          { konto: uttagInsattningKonto, belopp: negate(belopp) },
        ];

  const utkast = skapaUtkast({
    id: nyttId(kontext),
    datum,
    beskrivning: typ === 'uttag' ? 'Eget uttag' : 'Egen insättning',
    konteringar,
  });
  return bokforUtkast(db, kontext, utkast, serie);
}
