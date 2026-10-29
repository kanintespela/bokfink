import type { Uuid } from '../domain/id/uuidv7';
import type { Datum } from '../domain/tid/datum';
import {
  arOkopplat,
  farTasBort,
  OforanderligtUnderlagError,
  skapaUnderlag,
  type Sha256,
  type Underlag,
  type Underlagstyp,
} from '../domain/underlag/underlag';
import type { Verifikatutkast } from '../domain/verifikat/verifikat';
import { tillampa } from './bokforing';
import type { KonteraDatabase } from './db';
import { huvud, nyttId, taBortUtkast, type Skrivkontext } from './kommandon';
import { FIL_TABLE, UNDERLAG_TABLE, UTKAST_TABLE } from './schema';

/**
 * A stored file, addressed by the SHA-256 of its bytes.
 *
 * The bytes are a Uint8Array rather than a Blob. Both can be put in
 * IndexedDB, but a typed array is what every layer downstream wants anyway -
 * hashing, encryption in stage 5, and writing an archive - and it survives a
 * structured clone everywhere without the Blob-in-IndexedDB corners WebKit
 * has historically had.
 */
export interface FilRad {
  readonly sha256: Sha256;
  readonly mime: Underlagstyp;
  readonly storlek: number;
  readonly data: Uint8Array;
}

export interface Underlagsfil {
  readonly sha256: Sha256;
  readonly mime: string;
  readonly filnamn: string;
  readonly data: Uint8Array;
}

/**
 * Stores a file and records it in the log.
 *
 * Photographing the same receipt twice, or receiving it on a second device,
 * gives the same hash and therefore the same row: the underlag that is
 * already there is returned unchanged, with whatever links it has collected
 * intact, and `nytt` says which of the two happened - the interface has to be
 * able to tell someone their picture was already here. That is the whole
 * point of addressing files by content.
 *
 * The bytes are written before the log entry, deliberately. Dexie cannot hold
 * one transaction across both writes without the file table joining every
 * unrelated log write, so one of the two has to go first, and the asymmetry
 * decides which: bytes nobody references are dead weight a later sweep can
 * collect, while a log entry pointing at bytes that were never written is
 * bookkeeping with its evidence missing.
 */
export async function sparaUnderlag(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  fil: Underlagsfil,
): Promise<{ underlag: Underlag; nytt: boolean }> {
  const befintligt = await underlagMedHash(db, fil.sha256);
  if (befintligt !== undefined) {
    return { underlag: befintligt, nytt: false };
  }

  const underlag = skapaUnderlag({
    id: nyttId(kontext),
    sha256: fil.sha256,
    mime: fil.mime,
    storlek: fil.data.byteLength,
    filnamn: fil.filnamn,
    tillagd: kontext.nu(),
  });

  await db.table<FilRad, Sha256>(FIL_TABLE).put({
    sha256: underlag.sha256,
    mime: underlag.mime,
    storlek: underlag.storlek,
    data: fil.data,
  });

  await tillampa(db, { ...huvud(kontext), typ: 'underlag.tillagt', underlag });
  return { underlag, nytt: true };
}

export async function kopplaUnderlag(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  underlagId: Uuid,
  verifikatId: Uuid,
): Promise<void> {
  await tillampa(db, {
    ...huvud(kontext),
    typ: 'underlag.kopplat',
    underlagId,
    verifikatId,
  });
}

export async function frikopplaUnderlag(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  underlagId: Uuid,
  verifikatId: Uuid,
): Promise<void> {
  await tillampa(db, {
    ...huvud(kontext),
    typ: 'underlag.frikopplat',
    underlagId,
    verifikatId,
  });
}

/**
 * Throws away a stored file that no verifikat needs.
 *
 * A mis-shot, a picture of a table, a receipt photographed twice from
 * different angles: none of that is räkenskapsinformation, and a list that
 * cannot be tidied stops being read. What is attached to a booked verifikat
 * is a different thing entirely and is refused by name - bokföringslagen 7
 * kap. 2 § keeps it for seven years.
 *
 * The log entry goes first and the bytes after it. A file with no row is
 * dead weight a sweep can collect; a row whose file is gone is a receipt that
 * cannot be shown. The bytes are only removed when nothing else points at
 * them, since content addressing means two rows can share one file.
 */
export async function taBortUnderlag(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  underlagId: Uuid,
): Promise<void> {
  const underlag = await lasUnderlag(db, underlagId);
  if (underlag === undefined) {
    return;
  }
  const utkast = new Set(
    (await db.table<{ id: Uuid }, Uuid>(UTKAST_TABLE).bulkGet([...underlag.verifikat]))
      .filter((post) => post !== undefined)
      .map((post) => post.id),
  );
  if (!farTasBort(underlag, (id) => utkast.has(id))) {
    throw new OforanderligtUnderlagError(underlagId);
  }

  await tillampa(db, { ...huvud(kontext), typ: 'underlag.borttaget', underlagId });

  const kvar = await db
    .table<Underlag, Uuid>(UNDERLAG_TABLE)
    .where('sha256')
    .equals(underlag.sha256)
    .count();
  if (kvar === 0) {
    await db.table<FilRad, Sha256>(FIL_TABLE).delete(underlag.sha256);
  }
}

/**
 * Throws a draft away and sends its receipts back to wait.
 *
 * A draft carries its evidence the same way a verifikat does, by the link on
 * the underlag - booking keeps the draft's id, so the receipt is attached the
 * moment the draft is booked. The other outcome needs undoing by hand: a
 * receipt left linked to a draft that no longer exists would be neither
 * evidence for anything nor on the list of receipts waiting, which is the one
 * place anyone would look for it.
 *
 * The links go first. Stopped halfway, that leaves a draft whose receipt is
 * waiting again, which is visible and harmless; the other order could leave
 * the receipt lost.
 */
export async function kasseraUtkast(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  utkastId: Uuid,
): Promise<void> {
  for (const underlag of await underlagForVerifikat(db, utkastId)) {
    await frikopplaUnderlag(db, kontext, underlag.id, utkastId);
  }
  if ((await db.table<Verifikatutkast, Uuid>(UTKAST_TABLE).get(utkastId)) !== undefined) {
    await taBortUtkast(db, kontext, utkastId);
  }
}

/** Records what OCR read out of the file, so it can be searched later. */
export async function sparaUnderlagstext(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  underlagId: Uuid,
  text: string,
  sakerhet?: number,
): Promise<void> {
  await tillampa(db, {
    ...huvud(kontext),
    typ: 'underlag.avlast',
    underlagId,
    text,
    ...(sakerhet === undefined ? {} : { sakerhet }),
  });
}

/** Sets the day an invoice waiting as an underlag is due, or removes it. */
export async function sparaForfallodag(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  underlagId: Uuid,
  forfallodag: Datum | undefined,
): Promise<void> {
  await tillampa(db, {
    ...huvud(kontext),
    typ: 'underlag.forfallodag',
    underlagId,
    forfallodag: forfallodag ?? null,
  });
}

/** The bytes behind an underlag, for showing it or writing it to an archive. */
export async function lasFil(
  db: KonteraDatabase,
  sha256: Sha256,
): Promise<FilRad | undefined> {
  return db.table<FilRad, Sha256>(FIL_TABLE).get(sha256);
}

export async function lasUnderlag(
  db: KonteraDatabase,
  id: Uuid,
): Promise<Underlag | undefined> {
  return db.table<Underlag, Uuid>(UNDERLAG_TABLE).get(id);
}

/** What evidence a verifikat has, through the multiEntry index. */
export async function underlagForVerifikat(
  db: KonteraDatabase,
  verifikatId: Uuid,
): Promise<Underlag[]> {
  return db
    .table<Underlag, Uuid>(UNDERLAG_TABLE)
    .where('verifikat')
    .equals(verifikatId)
    .toArray();
}

/**
 * Files that have been stored but not attached to anything yet.
 *
 * This is the to-do list a photographed receipt lands on, so it is read
 * often. It cannot use the index - a multiEntry index has no entry at all for
 * an empty array, so "no links" is exactly the case IndexedDB cannot be asked
 * about - and is filtered in memory instead. That is affordable precisely
 * because the list is meant to be short: an underlag stays here only until it
 * is booked.
 */
export async function okoppladeUnderlag(db: KonteraDatabase): Promise<Underlag[]> {
  const alla = await db.table<Underlag, Uuid>(UNDERLAG_TABLE).toArray();
  return alla.filter(arOkopplat).sort((a, b) => a.tillagd.localeCompare(b.tillagd));
}

async function underlagMedHash(
  db: KonteraDatabase,
  sha256: Sha256,
): Promise<Underlag | undefined> {
  return db.table<Underlag, Uuid>(UNDERLAG_TABLE).where('sha256').equals(sha256).first();
}
