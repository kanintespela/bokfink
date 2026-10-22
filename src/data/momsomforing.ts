import {
  momsomforingskonteringar,
  type Momsomforing,
} from '../domain/bokslut/momsomforing';
import type { Datum } from '../domain/tid/datum';
import type { Verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast, type BokfortVerifikat } from '../domain/verifikat/verifikat';
import type { KonteraDatabase } from './db';
import { bokforUtkast, nyttId, type Skrivkontext } from './kommandon';

/**
 * Books the two-line verifikat that moves a momsfordran to its own account.
 *
 * Dated the last day of the räkenskapsår: it is a bokslutspost, and the
 * balance it moves is the one the year ends with.
 */
export async function bokforMomsomforing(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  bokslutsdag: Datum,
  serie: Verifikatserie,
  omforing: Momsomforing,
): Promise<BokfortVerifikat> {
  const utkast = skapaUtkast({
    id: nyttId(kontext),
    datum: bokslutsdag,
    beskrivning: `Momsfordran flyttad från ${omforing.fran} till ${omforing.till}`,
    konteringar: momsomforingskonteringar(omforing),
  });
  return bokforUtkast(db, kontext, utkast, serie);
}
