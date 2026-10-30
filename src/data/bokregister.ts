import Dexie, { type Table } from 'dexie';

import type { Bokprofil } from '../domain/bok/bokprofil';
import { BOK_ID_NYCKEL, BOK_PROFIL_NYCKEL, URSPRUNGLIG_BOK } from './bokidentitet';
import { KonteraDatabase } from './db';
import { newIdentifier } from './id';

/**
 * One set of books: the firm's, an association's, anything kept apart.
 *
 * Each book is a database of its own rather than a column on every row. The
 * books then cannot leak into each other's reports, a backup or an archive
 * is one book and nothing else, and a treasurer's books can be handed to the
 * next treasurer whole. The original database stays where it was, so the
 * books kept before this existed needed no migration at all.
 */
export interface Bok {
  /** The book's identity, the same as its database holds (see bokidentitet.ts). */
  readonly id: string;
  readonly namn: string;
  /** The IndexedDB database the book lives in. */
  readonly databas: string;
  readonly skapad: string;
}

interface Valrad {
  readonly key: string;
  readonly value: string;
}

/** The database every installation has kept its books in from the start. */
export const URSPRUNGLIG_DATABAS = 'kontera';

/** What a new book's database is called, followed by the book's identity. */
const BOKDATABAS_PREFIX = 'kontera-bok-';

const AKTIV_NYCKEL = 'aktiv';

/** Long enough for "Exempelbygdens Bygdegårdsförening", short enough for a header. */
export const LANGSTA_BOKNAMN = 40;

/**
 * Which books there are on this device, and which one is open.
 *
 * Its own small database, because it has to be read before any book is
 * opened. It holds no bookkeeping: losing it loses the names, never the books,
 * and {@link lasBocker} finds the databases again by their names.
 */
export class Bokregister extends Dexie {
  readonly bocker!: Table<Bok, string>;
  readonly val!: Table<Valrad, string>;

  constructor(name = 'kontera-bocker') {
    super(name);
    this.version(1).stores({ bocker: 'id', val: 'key' });
  }
}

export interface Registerkontext {
  readonly nu: () => string;
  readonly nyttId?: () => string;
  /** The databases on this device, so a book missing from the register is found. */
  readonly databaser?: () => Promise<readonly string[]>;
}

export class OgiltigtBoknamnError extends Error {
  constructor(meddelande: string) {
    super(meddelande);
    this.name = 'OgiltigtBoknamnError';
  }
}

/**
 * A name a book can have: something, not too long, and not another book's.
 *
 * Unique ignoring case, because the name is the only thing telling two books
 * apart in the header, and "Föreningen" beside "föreningen" tells nothing.
 */
export function granskaBoknamn(
  namn: string,
  bocker: readonly Bok[],
  egetId?: string,
): string {
  const rent = namn.trim().replace(/\s+/g, ' ');
  if (rent.length === 0) {
    throw new OgiltigtBoknamnError('Ge boken ett namn.');
  }
  if (rent.length > LANGSTA_BOKNAMN) {
    throw new OgiltigtBoknamnError(
      `Namnet får vara högst ${LANGSTA_BOKNAMN} tecken långt.`,
    );
  }
  const krock = bocker.find(
    (bok) =>
      bok.id !== egetId &&
      bok.namn.toLocaleLowerCase('sv') === rent.toLocaleLowerCase('sv'),
  );
  if (krock !== undefined) {
    throw new OgiltigtBoknamnError(`Det finns redan en bok som heter ${krock.namn}.`);
  }
  return rent;
}

/**
 * Every book on the device, the original first and then oldest first, and the
 * one to open.
 *
 * The original book is always there, registered on first use under a name
 * that can be changed. A book database the register has lost - cleared site
 * data can take one table and spare another - is registered again rather than
 * left invisible, under a name saying what happened.
 */
export async function lasBocker(
  register: Bokregister,
  kontext: Registerkontext,
): Promise<{ bocker: readonly Bok[]; aktiv: Bok }> {
  const kanda = await register.bocker.toArray();

  if (!kanda.some((bok) => bok.databas === URSPRUNGLIG_DATABAS)) {
    const ursprunglig: Bok = {
      id: URSPRUNGLIG_BOK,
      namn: granskaBoknamn('Min bokföring', kanda),
      databas: URSPRUNGLIG_DATABAS,
      skapad: kontext.nu(),
    };
    await register.bocker.put(ursprunglig);
    kanda.push(ursprunglig);
  }

  for (const databas of (await kontext.databaser?.()) ?? []) {
    if (
      !databas.startsWith(BOKDATABAS_PREFIX) ||
      kanda.some((bok) => bok.databas === databas)
    ) {
      continue;
    }
    let nummer = 1;
    while (kanda.some((bok) => bok.namn === `Återfunnen bok ${nummer}`)) {
      nummer += 1;
    }
    const aterfunnen: Bok = {
      id: databas.slice(BOKDATABAS_PREFIX.length),
      namn: `Återfunnen bok ${nummer}`,
      databas,
      skapad: kontext.nu(),
    };
    await register.bocker.put(aterfunnen);
    kanda.push(aterfunnen);
  }

  const bocker = kanda.sort(
    (a, b) =>
      Number(b.databas === URSPRUNGLIG_DATABAS) -
        Number(a.databas === URSPRUNGLIG_DATABAS) ||
      a.skapad.localeCompare(b.skapad) ||
      a.id.localeCompare(b.id),
  );
  const valt = (await register.val.get(AKTIV_NYCKEL))?.value;
  const aktiv =
    bocker.find((bok) => bok.id === valt) ??
    bocker.find((bok) => bok.databas === URSPRUNGLIG_DATABAS)!;
  return { bocker, aktiv };
}

/**
 * Starts a new, empty book.
 *
 * Its database is created here with the identity and the profile written into
 * it, so that every backup it ever makes says which book it is a copy of and
 * what kind of book that is. The profile is given here and nowhere else: a
 * book's kind is not changed afterwards (see bokprofil.ts). Making it
 * ready to book - a fiscal year, the starting accounts - happens when it is
 * first opened, exactly as for the original.
 */
export async function skapaBok(
  register: Bokregister,
  kontext: Registerkontext,
  namn: string,
  profil: Bokprofil,
): Promise<Bok> {
  const { bocker } = await lasBocker(register, kontext);
  const id = (kontext.nyttId ?? newIdentifier)();
  const bok: Bok = {
    id,
    namn: granskaBoknamn(namn, bocker),
    databas: `${BOKDATABAS_PREFIX}${id}`,
    skapad: kontext.nu(),
  };

  const db = new KonteraDatabase(bok.databas);
  try {
    await db.setMeta(BOK_ID_NYCKEL, id);
    await db.setMeta(BOK_PROFIL_NYCKEL, profil);
  } finally {
    db.close();
  }

  await register.bocker.put(bok);
  return bok;
}

export async function bytNamnPaBok(
  register: Bokregister,
  kontext: Registerkontext,
  id: string,
  namn: string,
): Promise<Bok> {
  const { bocker } = await lasBocker(register, kontext);
  const bok = bocker.find((kandidat) => kandidat.id === id);
  if (bok === undefined) {
    throw new Error(`Boken ${id} finns inte på den här enheten.`);
  }
  const ny = { ...bok, namn: granskaBoknamn(namn, bocker, id) };
  await register.bocker.put(ny);
  return ny;
}

/**
 * How the files a book exports begin, so that a folder of backups and SIE
 * files says whose books each one holds.
 *
 * The original book keeps the names it always had - its backups are already
 * sitting in folders under them. Any other book adds its own name, folded to
 * what every file system accepts.
 */
export function filprefix(bok: Bok): string {
  if (bok.databas === URSPRUNGLIG_DATABAS) {
    return 'kontera';
  }
  const namn = bok.namn
    .toLocaleLowerCase('sv')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return namn.length === 0 ? 'kontera-bok' : `kontera-${namn}`;
}

/** Remembers which book this device opens next time. */
export async function valjBok(register: Bokregister, id: string): Promise<void> {
  if ((await register.bocker.get(id)) === undefined) {
    throw new Error(`Boken ${id} finns inte på den här enheten.`);
  }
  await register.val.put({ key: AKTIV_NYCKEL, value: id });
}
