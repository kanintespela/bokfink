import {
  beraknaForeningskapital,
  reserveringKonteringar,
  type Foreningskapital,
  type Reserveringsriktning,
} from '../domain/bokslut/foreningskapital';
import { beraknaForenkladArsbokslut } from '../domain/bokslut/forenkladArsbokslut';
import type { Ore } from '../domain/belopp/ore';
import { kontonummer, skapaKonto, type Kontonummer } from '../domain/konto/konto';
import { omfattar, type Rakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { beraknaSaldon } from '../domain/rapport/saldon';
import type { Datum } from '../domain/tid/datum';
import type { Verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast, type BokfortVerifikat } from '../domain/verifikat/verifikat';
import { lasTillstand } from './bokforing';
import type { KonteraDatabase } from './db';
import { bokforUtkast, nyttId, skrivKonto, type Skrivkontext } from './kommandon';

/** Where the accounts holding reserved funds are listed, in the book's metadata. */
export const RESERVERADE_KONTON_NYCKEL = 'reserveradeMedelKonton';

/**
 * The accounts the association has set funds aside on.
 *
 * Listed rather than recognised by number, because a kontoplan imported from
 * another program has its own numbers and nothing in an account says it is a
 * reservation. Kept in the book so that the year-end transfer and the capital
 * page agree on which accounts they are.
 */
export async function lasReserveradeKonton(
  db: KonteraDatabase,
): Promise<readonly Kontonummer[]> {
  const lagrade = (await db.getMeta<readonly string[]>(RESERVERADE_KONTON_NYCKEL)) ?? [];
  return lagrade.map((konto) => kontonummer(konto));
}

/** The association's capital for a year, split on what is reserved. */
export async function foreningskapitalFor(
  db: KonteraDatabase,
  ar: Rakenskapsar,
): Promise<Foreningskapital> {
  const tillstand = await lasTillstand(db);
  const iAret: BokfortVerifikat[] = [...tillstand.verifikat.values()].filter((v) =>
    omfattar(ar, v.datum),
  );
  const saldon = beraknaSaldon(ar.ingaendeBalanser, iAret);
  return beraknaForeningskapital({
    ingaendeBalanser: ar.ingaendeBalanser,
    verifikat: iAret,
    reserveradeKonton: await lasReserveradeKonton(db),
    // Every result account, placed in the K1 form or not, less the transfer
    // onto the capital accounts: the year's result as the books have it.
    resultat: beraknaForenkladArsbokslut(saldon).resultatEnligtBokforingen,
  });
}

/**
 * Sets funds aside for a purpose, or frees them again, as a verifikat inside
 * eget kapital (BFNAR 2010:1 punkt 6.67: a reservation does not touch the
 * result).
 *
 * The purpose is an account of its own. An account that does not exist yet is
 * created with the name given, so the association's purposes can be added as
 * they are decided; one that exists keeps its name. The account is listed as
 * a reservation before anything is booked on it: a listed account that never
 * got a balance changes nothing, while a booked one that was not listed would
 * be folded into 2010 at the next year-end.
 */
export async function bokforReservering(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  uppgifter: {
    readonly datum: Datum;
    readonly serie: Verifikatserie;
    readonly konto: Kontonummer;
    /** Used only when the account has to be created. */
    readonly namn: string;
    readonly belopp: Ore;
    readonly riktning: Reserveringsriktning;
  },
): Promise<BokfortVerifikat> {
  // Throws before anything is written when the account or amount is no good.
  const konteringar = reserveringKonteringar(
    uppgifter.konto,
    uppgifter.belopp,
    uppgifter.riktning,
  );

  const tillstand = await lasTillstand(db);
  const befintlig = tillstand.konton.get(uppgifter.konto);
  if (befintlig === undefined) {
    await skrivKonto(
      db,
      kontext,
      skapaKonto({ nummer: uppgifter.konto, namn: uppgifter.namn.trim() }),
    );
  }
  const namn = befintlig?.namn ?? uppgifter.namn.trim();

  const listade = await lasReserveradeKonton(db);
  if (!listade.includes(uppgifter.konto)) {
    await db.setMeta(RESERVERADE_KONTON_NYCKEL, [...listade, uppgifter.konto]);
  }

  const utkast = skapaUtkast({
    id: nyttId(kontext),
    datum: uppgifter.datum,
    beskrivning:
      uppgifter.riktning === 'reservera'
        ? `Reservering: ${namn}`
        : `Frigjorda reserverade medel: ${namn}`,
    konteringar,
  });
  return bokforUtkast(db, kontext, utkast, uppgifter.serie);
}
