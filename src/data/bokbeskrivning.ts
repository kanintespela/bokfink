import type { Bokbeskrivning } from '../domain/bok/bokbeskrivning';
import type { Momsperiod } from '../domain/moms/period';
import type { Redovisningsmetod } from '../domain/moms/redovisningsmetod';
import {
  BOK_BRANSCH_NYCKEL,
  BOK_NAMN_NYCKEL,
  BOK_PROFIL_NYCKEL,
  lasBokprofil,
} from './bokidentitet';
import type { BokfinkDatabase } from './db';

/*
 * The settings a description carries, under the keys the rest of the app
 * reads them by. Only what the book has chosen is there: a book that never
 * touched the setting describes none, and the joining device falls back on
 * the same default the first one does.
 */
const MOMSPERIOD_NYCKEL = 'momsperiod';
const MOMSREGISTRERAD_NYCKEL = 'momsregistrerad';
const REDOVISNINGSMETOD_NYCKEL = 'redovisningsmetod';

/**
 * What this device would tell another about the book it has open.
 *
 * The name is given rather than read: it is the register's, which is where
 * the header takes it from, and the copy in the book's metadata is only
 * written when a backup is made.
 */
export async function lasBokbeskrivning(
  db: BokfinkDatabase,
  namn: string,
): Promise<Bokbeskrivning> {
  const [profil, bransch, momsperiod, momsregistrerad, redovisningsmetod] =
    await Promise.all([
      lasBokprofil(db),
      db.getMeta<Bokbeskrivning['bransch']>(BOK_BRANSCH_NYCKEL),
      db.getMeta<Momsperiod>(MOMSPERIOD_NYCKEL),
      db.getMeta<boolean>(MOMSREGISTRERAD_NYCKEL),
      db.getMeta<Redovisningsmetod>(REDOVISNINGSMETOD_NYCKEL),
    ]);
  return {
    namn,
    profil,
    ...(bransch === undefined ? {} : { bransch }),
    ...(momsperiod === undefined ? {} : { momsperiod }),
    ...(momsregistrerad === undefined ? {} : { momsregistrerad }),
    ...(redovisningsmetod === undefined ? {} : { redovisningsmetod }),
  };
}

/**
 * Writes a description into a book's metadata, for a book that is being
 * joined and holds nothing yet.
 *
 * Never used on a book someone has kept: its profile is not changed
 * afterwards (see bokprofil.ts), and its settings are its owner's.
 */
export async function antaBokbeskrivning(
  db: BokfinkDatabase,
  beskrivning: Bokbeskrivning,
): Promise<void> {
  await db.setMeta(BOK_NAMN_NYCKEL, beskrivning.namn);
  await db.setMeta(BOK_PROFIL_NYCKEL, beskrivning.profil);
  if (beskrivning.bransch !== undefined) {
    await db.setMeta(BOK_BRANSCH_NYCKEL, beskrivning.bransch);
  }
  if (beskrivning.momsperiod !== undefined) {
    await db.setMeta(MOMSPERIOD_NYCKEL, beskrivning.momsperiod);
  }
  if (beskrivning.momsregistrerad !== undefined) {
    await db.setMeta(MOMSREGISTRERAD_NYCKEL, beskrivning.momsregistrerad);
  }
  if (beskrivning.redovisningsmetod !== undefined) {
    await db.setMeta(REDOVISNINGSMETOD_NYCKEL, beskrivning.redovisningsmetod);
  }
}
