import Dexie from 'dexie';

import { skyddaBokfordaVerifikat } from './bokforing';
import { Bokregister, lasBocker, type Bok, type Registerkontext } from './bokregister';
import { KonteraDatabase } from './db';

/**
 * The application's databases: the register of books, and one database per
 * book.
 *
 * Tests build their own instances with throwaway names; nothing outside the
 * app entry point should reach for these directly.
 */
export const register = new Bokregister();

export const registerkontext: Registerkontext = {
  nu: () => new Date().toISOString(),
  databaser: () => Dexie.getDatabaseNames(),
};

const oppna = new Map<string, KonteraDatabase>();

/**
 * The database a book lives in, opened once per page load.
 *
 * Kept rather than made anew on every switch: a second Dexie instance on the
 * same database would carry its own copy of the hooks below, and switching
 * back and forth would stack them up.
 */
export function databasFor(bok: Bok): KonteraDatabase {
  const redan = oppna.get(bok.databas);
  if (redan !== undefined) {
    return redan;
  }
  const db = new KonteraDatabase(bok.databas);
  // Hard rule 5, applied to the live database rather than left to callers.
  skyddaBokfordaVerifikat(db);
  oppna.set(bok.databas, db);
  return db;
}

/**
 * Lets go of a book's open database, so that it can be deleted.
 *
 * A database cannot be deleted while a connection to it is open, and this
 * module is the one that holds the connections.
 */
export function stangDatabas(bok: Bok): void {
  const db = oppna.get(bok.databas);
  if (db !== undefined) {
    db.close();
    oppna.delete(bok.databas);
  }
}

export function lasBockerPaEnheten() {
  return lasBocker(register, registerkontext);
}
