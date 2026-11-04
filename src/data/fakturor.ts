import type { Ore } from '../domain/belopp/ore';
import type { Uuid } from '../domain/id/uuidv7';
import type { Kontonummer } from '../domain/konto/konto';
import type { Datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { beteckning, type BokfortVerifikat } from '../domain/verifikat/verifikat';
import { betalning, fakturor, FelBetalningError } from '../domain/verifikat/reskontra';
import { lasTillstand } from './bokforing';
import type { BokfinkDatabase } from './db';
import { bokforUtkast, nyttId, type Skrivkontext } from './kommandon';

/**
 * Books a payment of an invoice kept with faktureringsmetoden.
 *
 * The invoice is looked up again here, from the books as they stand, rather
 * than taken from the screen: two devices may both have shown it as open,
 * and what is left on it is decided by what has been booked, not by what was
 * on screen when the button was pressed.
 */
export async function registreraBetalning(
  db: BokfinkDatabase,
  kontext: Skrivkontext,
  fakturaId: Uuid,
  uppgifter: {
    readonly datum: Datum;
    readonly belopp: Ore;
    readonly betalkonto: Kontonummer;
  },
): Promise<BokfortVerifikat> {
  const tillstand = await lasTillstand(db);
  const faktura = fakturor([...tillstand.verifikat.values()]).find(
    (kandidat) => kandidat.verifikat.id === fakturaId,
  );
  if (faktura === undefined) {
    throw new FelBetalningError('Fakturan finns inte längre i bokföringen.');
  }

  const utkast = betalning(faktura, {
    id: nyttId(kontext),
    datum: uppgifter.datum,
    belopp: uppgifter.belopp,
    betalkonto: uppgifter.betalkonto,
    beteckning: beteckning(faktura.verifikat),
  });
  return bokforUtkast(db, kontext, utkast, verifikatserie(faktura.verifikat.serie));
}
