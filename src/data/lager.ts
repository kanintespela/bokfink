import {
  lagervarde,
  skapaDjurlagerinventering,
  type Djurlagerinventering,
  type Djurlagerinventeringsuppgifter,
} from '../domain/lager/djurlager';
import { formatKronor, ZERO } from '../domain/belopp/ore';
import { LAGERKONTO, lagerforandringskonteringar } from '../domain/lager/lagerforandring';
import { omfattar } from '../domain/rakenskapsar/rakenskapsar';
import { beraknaSaldon } from '../domain/rapport/saldon';
import type { Verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast, type BokfortVerifikat } from '../domain/verifikat/verifikat';
import { lasTillstand, tillampa } from './bokforing';
import type { KonteraDatabase } from './db';
import { bokforUtkast, huvud, nyttId, type Skrivkontext } from './kommandon';

export async function registreraDjurlagerinventering(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  uppgifter: Omit<Djurlagerinventeringsuppgifter, 'id'>,
): Promise<Djurlagerinventering> {
  const inventering = skapaDjurlagerinventering({ id: nyttId(kontext), ...uppgifter });
  await tillampa(db, { ...huvud(kontext), typ: 'djurlager.inventerat', inventering });
  return inventering;
}

/** Alla inventeringar, senaste först - den senaste är lagrets nuvarande värde. */
export async function djurlagerinventeringar(
  db: KonteraDatabase,
): Promise<readonly Djurlagerinventering[]> {
  const tillstand = await lasTillstand(db);
  return [...tillstand.djurlagerinventeringar.values()].sort((a, b) =>
    b.datum.localeCompare(a.datum),
  );
}

/**
 * Books the year-end count into the ledger: the stock account brought to the
 * counted value, the difference against lagerförändring.
 *
 * Made once a year, on the balansdag, as the owner has always done it - a
 * count on any other day is not the value K1 asks for, and is refused. What
 * the account already holds is read from the ledger, so pressing twice books
 * nothing the second time and says why.
 */
export async function bokforLagerforandring(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  inventering: Djurlagerinventering,
  serie: Verifikatserie,
): Promise<BokfortVerifikat> {
  const tillstand = await lasTillstand(db);
  const ar = [...tillstand.rakenskapsar.values()].find((kandidat) =>
    omfattar(kandidat, inventering.datum),
  );
  if (ar === undefined) {
    throw new Error(`Det finns inget räkenskapsår som omfattar ${inventering.datum}.`);
  }
  if (inventering.datum !== ar.slut) {
    throw new Error(
      `Lagret bokförs efter inventeringen på räkenskapsårets sista dag, ${ar.slut}. ` +
        `Den här inventeringen är gjord ${inventering.datum}.`,
    );
  }

  const iAret = [...tillstand.verifikat.values()].filter((verifikat) =>
    omfattar(ar, verifikat.datum),
  );
  const saldon = beraknaSaldon(ar.ingaendeBalanser, iAret);
  const inventerat = lagervarde(inventering);
  const rader = lagerforandringskonteringar(
    inventerat,
    saldon.get(LAGERKONTO)?.utgaende ?? ZERO,
  );
  if (rader === undefined) {
    throw new Error(
      `Lagret står redan på ${formatKronor(inventerat)} kr i bokföringen. Det finns ` +
        'ingen förändring att bokföra.',
    );
  }

  return bokforUtkast(
    db,
    kontext,
    skapaUtkast({
      id: nyttId(kontext),
      datum: inventering.datum,
      beskrivning: 'Lagerförändring djurlager',
      konteringar: rader,
    }),
    serie,
  );
}

export { lagervarde };
