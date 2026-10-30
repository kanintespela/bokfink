import {
  aterforing as vandRader,
  bokslutspostKonteringar,
  type Bokslutskatalog,
  type Bokslutspost,
} from '../domain/bokslut/bokslutspost';
import { nastaRakenskapsarsperiod } from '../domain/bokslut/arsavslut';
import { paverkarMomsdeklarationen } from '../domain/moms/momsrapport';
import {
  kontrolleraBokforingsbart,
  kontrolleraInteFramtida,
  type Rakenskapsar,
} from '../domain/rakenskapsar/rakenskapsar';
import type { Verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast, type BokfortVerifikat } from '../domain/verifikat/verifikat';
import { skapaNastaRakenskapsar } from './arsavslut';
import type { KonteraDatabase } from './db';
import { bokforUtkast, nyttId, type Skrivkontext } from './kommandon';

/**
 * Takes a K1 year-end item up on the year's last day and reverses it on the
 * next year's first, in one step.
 *
 * Both halves are checked before either is written, so a refusal - a locked
 * declaration, a closed year, a next year that has not begun - leaves the
 * books as they were rather than holding a year-end item with no reversal.
 * Next year is created if it does not exist yet; its identifier comes from
 * its start date, so a second device doing the same arrives at the same year.
 */
export async function bokforBokslutspost(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  ar: Rakenskapsar,
  post: Bokslutspost,
  beskrivning: string,
  serie: Verifikatserie,
  katalog?: Bokslutskatalog,
): Promise<{ verifikat: BokfortVerifikat; aterforing: BokfortVerifikat }> {
  const konteringar = bokslutspostKonteringar(post, katalog);
  const tillbaka = vandRader(konteringar);
  const text = beskrivning.trim();

  if (kontext.idag !== undefined) {
    // The reversal is the later of the two, so it is the one that could be
    // in the future: an item is booked once the new year has begun.
    kontrolleraInteFramtida(ar.slut, kontext.idag());
  }
  kontrolleraBokforingsbart(ar, ar.slut, paverkarMomsdeklarationen(konteringar));

  if (kontext.idag !== undefined) {
    kontrolleraInteFramtida(nastaRakenskapsarsperiod(ar).start, kontext.idag());
  }
  const nasta = await skapaNastaRakenskapsar(db, kontext, ar);
  kontrolleraBokforingsbart(nasta, nasta.start, paverkarMomsdeklarationen(tillbaka));

  const verifikat = await bokforUtkast(
    db,
    kontext,
    skapaUtkast({ id: nyttId(kontext), datum: ar.slut, beskrivning: text, konteringar }),
    serie,
  );
  const aterforing = await bokforUtkast(
    db,
    kontext,
    skapaUtkast({
      id: nyttId(kontext),
      datum: nasta.start,
      beskrivning: `Återföring: ${text}`,
      konteringar: tillbaka,
    }),
    serie,
  );
  return { verifikat, aterforing };
}
