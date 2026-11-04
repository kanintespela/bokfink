import { z } from 'zod';

import { formatKronor, type Ore } from '../domain/belopp/ore';
import type { Handelse } from '../domain/handelse/handelse';
import type { Uuid } from '../domain/id/uuidv7';
import { arUnderlagstyp, sha256, type Sha256 } from '../domain/underlag/underlag';
import {
  beteckning,
  granskaBokfortVerifikat,
  ObalanseratVerifikatError as DomanObalanseratVerifikatError,
} from '../domain/verifikat/verifikat';
import { franBase64, tillBase64 } from './base64';
import { lasLogg, tillampaAlla } from './bokforing';
import {
  BOK_ID_NYCKEL,
  BOK_PROFIL_NYCKEL,
  bokIdIMeta,
  bokprofilIMeta,
  lasBokId,
} from './bokidentitet';
import type { BokfinkDatabase } from './db';
import {
  FIL_TABLE,
  HANDELSE_TABLE,
  latestSchemaVersion,
  META_TABLE,
  type MetaRow,
} from './schema';
import type { FilRad } from './underlag';
import { harEnbartOskickadStartdata, slappStartdata } from './uppstart';

/**
 * A stored file, as JSON can carry it.
 *
 * `sha256` is both the address and the checksum: a restore can be told to
 * hash the bytes back and refuse a file that does not match, which is what
 * makes this a verified copy rather than a hopeful one.
 */
export interface Filkopia {
  readonly sha256: Sha256;
  readonly mime: string;
  readonly storlek: number;
  /** The bytes, base64-encoded, because JSON has no other way to hold them. */
  readonly data: string;
}

/**
 * The whole database as one JSON document.
 *
 * The log, the metadata, and the files. Every other table is a view of the
 * log and is rebuilt on import, which means a backup cannot contain a table
 * that disagrees with the log it came from - the failure that would be
 * hardest to notice and worst to restore.
 *
 * The files are the exception, and they are here for the same reason: they
 * are the one thing that cannot be rebuilt from the log. A backup that left
 * them out would restore bookkeeping whose evidence had disappeared, and
 * bokföringslagen 7 kap. 1 § asks for both.
 *
 * Format version 2 is version 1 plus `filer`. A version 1 file still reads,
 * because one exists in the wild the moment anyone has taken a backup.
 */
export interface Sakerhetskopia {
  readonly format: 'kontera-backup';
  readonly formatversion: 2;
  readonly schemaversion: number;
  readonly skapad: string;
  readonly meta: readonly MetaRow[];
  readonly handelser: readonly Handelse[];
  readonly filer: readonly Filkopia[];
}

const metaRad = z.object({
  key: z.string(),
  value: z.unknown(),
  updatedAt: z.string(),
});

/**
 * Validated at the boundary rather than trusted.
 *
 * A backup is the one file the whole project promises will still be readable
 * when everything else has failed, so it is checked on the way in even though
 * this program is what wrote it. The entries themselves are passed through as
 * unknown shape and re-validated by the domain when they are applied.
 */
const filkopia = z.object({
  sha256: z.string(),
  mime: z.string(),
  storlek: z.number().int().nonnegative(),
  data: z.string(),
});

const sakerhetskopia = z.object({
  format: z.literal('kontera-backup'),
  formatversion: z.union([z.literal(1), z.literal(2)]),
  schemaversion: z.number().int().positive(),
  skapad: z.string(),
  meta: z.array(metaRad),
  handelser: z.array(z.object({ id: z.string(), typ: z.string() }).passthrough()),
  // Absent in a version 1 file, which was written before there were files.
  filer: z.array(filkopia).default([]),
});

export class OlasbarSakerhetskopiaError extends Error {
  constructor(orsak: string) {
    super(`Filen går inte att läsa som en säkerhetskopia från Bokfink: ${orsak}`);
    this.name = 'OlasbarSakerhetskopiaError';
  }
}

export async function exportera(
  db: BokfinkDatabase,
  nu: () => string = () => new Date().toISOString(),
): Promise<Sakerhetskopia> {
  const [meta, handelser, filer] = await Promise.all([
    db.table<MetaRow, string>(META_TABLE).toArray(),
    lasLogg(db),
    db.table<FilRad, Sha256>(FIL_TABLE).toArray(),
  ]);

  return {
    format: 'kontera-backup',
    formatversion: 2,
    schemaversion: db.verno,
    skapad: nu(),
    meta,
    handelser,
    filer: filer.map((rad) => ({
      sha256: rad.sha256,
      mime: rad.mime,
      storlek: rad.storlek,
      data: tillBase64(rad.data),
    })),
  };
}

export async function exporteraSomText(
  db: BokfinkDatabase,
  nu?: () => string,
): Promise<string> {
  return `${JSON.stringify(await exportera(db, nu), undefined, 2)}\n`;
}

export function las(text: string): Sakerhetskopia {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new OlasbarSakerhetskopiaError('den innehåller inte giltig JSON.');
  }

  const resultat = sakerhetskopia.safeParse(json);
  if (!resultat.success) {
    throw new OlasbarSakerhetskopiaError(
      resultat.error.issues[0]?.message ?? 'okänt fel',
    );
  }

  if (resultat.data.schemaversion > latestSchemaVersion()) {
    throw new OlasbarSakerhetskopiaError(
      `den kommer från databasversion ${resultat.data.schemaversion}, och den här ` +
        `versionen av Bokfink förstår som mest ${latestSchemaVersion()}. Uppdatera ` +
        'appen först.',
    );
  }

  return resultat.data as unknown as Sakerhetskopia;
}

export class SkadadFilError extends Error {
  constructor(sha256: string) {
    super(
      `Filen med kontrollsumma ${sha256} i säkerhetskopian stämmer inte med sin ` +
        'egen kontrollsumma. Kopian är skadad och återställningen avbröts.',
    );
    this.name = 'SkadadFilError';
  }
}

export class ObalanseratVerifikatError extends Error {
  constructor(beteckning: string, skillnad: Ore) {
    super(
      `Säkerhetskopian innehåller verifikat ${beteckning} där debet och kredit skiljer ` +
        `${formatKronor(skillnad)} kr. Ett sådant verifikat kan inte bokföras, så kopian ` +
        'är skadad eller har ändrats för hand. Ingenting lästes in.',
    );
    this.name = 'ObalanseratVerifikatError';
  }
}

export class AnnanBokError extends Error {
  constructor() {
    super(
      'Säkerhetskopian kommer från en annan bok än den som är öppen, och att läsa in ' +
        'den här skulle blanda ihop två bokföringar. Byt till rätt bok och försök igen, ' +
        'eller skapa en ny bok och läs in kopian i den.',
    );
    this.name = 'AnnanBokError';
  }
}

export interface Importalternativ {
  /**
   * Hashes bytes, so a restore can check each file against its own address.
   *
   * Passed in rather than imported: Web Crypto belongs to the platform layer,
   * and this one is in data/. Left out, the files are restored unchecked -
   * which is what a test that only cares about the log wants.
   */
  readonly hasha?: (data: Uint8Array) => Promise<Sha256>;
}

/**
 * Restores into a database, replaying the log so every table is rebuilt from
 * it rather than trusted from the file.
 *
 * Merges rather than replaces: entries already present are skipped, which is
 * what makes restoring twice safe and what will let a backup from one device
 * be folded into another.
 */
export async function importera(
  db: BokfinkDatabase,
  kopia: Sakerhetskopia,
  alternativ: Importalternativ = {},
): Promise<{ nyaHandelser: number; nyaFiler: number }> {
  /*
   * A restore merges, so a copy of another book's entries would be folded
   * into this one for good - hard rule 5 leaves no way to take booked
   * verifikat back out. Checked before anything is written.
   *
   * A database holding nothing yet, or nothing but its starter set, is where
   * a book is restored onto a new device, and takes the copy's identity.
   */
  /*
   * Hard rule 4: debit equals credit. The log is replayed as it stands, so a
   * verifikat that does not balance would be booked as it is. Checked first
   * of all, so a refusal leaves nothing behind.
   */
  for (const handelse of kopia.handelser) {
    if (handelse.typ !== 'verifikat.bokfort') {
      continue;
    }
    try {
      granskaBokfortVerifikat(handelse.verifikat);
    } catch (orsak) {
      if (orsak instanceof DomanObalanseratVerifikatError) {
        throw new ObalanseratVerifikatError(
          beteckning(handelse.verifikat),
          orsak.differens,
        );
      }
      const v = handelse.verifikat;
      const namn =
        typeof v?.serie === 'string' && typeof v.nummer === 'number'
          ? beteckning(v)
          : '(utan beteckning)';
      throw new OlasbarSakerhetskopiaError(
        `verifikat ${namn} är ogiltigt: ${orsak instanceof Error ? orsak.message : String(orsak)} Ingenting lästes in.`,
      );
    }
  }

  // Web Crypto is not an IndexedDB request. Finish it before opening the
  // transaction, or the browser can commit the transaction while it awaits a
  // digest. Validate even files already present: corruption is never skipped.
  const filer: FilRad[] = [];
  for (const fil of kopia.filer) {
    const adress = sha256(fil.sha256);
    const data = franBase64(fil.data);
    if (
      data.byteLength !== fil.storlek ||
      !arUnderlagstyp(fil.mime) ||
      (alternativ.hasha !== undefined && (await alternativ.hasha(data)) !== adress)
    ) {
      throw new SkadadFilError(fil.sha256);
    }
    filer.push({
      sha256: adress,
      mime: fil.mime as FilRad['mime'],
      storlek: fil.storlek,
      data,
    });
  }

  // A failure in the last replayed event must roll back identity, metadata,
  // files, starter data and every earlier event, not only the failing event.
  return db.transaction('rw', db.tables, async () => {
    const kopiansBok = bokIdIMeta(kopia.meta);
    if (kopiansBok !== (await lasBokId(db))) {
      const tom =
        (await lasLogg(db)).length === 0 || (await harEnbartOskickadStartdata(db));
      if (!tom) {
        throw new AnnanBokError();
      }
      await db.setMeta(BOK_ID_NYCKEL, kopiansBok);
      /*
       * The profile goes with the identity, also when the copy records none: an
       * empty association book that took an old firm's identity and kept its
       * own profile would be a firm's books under an association's screens.
       */
      await db.setMeta(BOK_PROFIL_NYCKEL, bokprofilIMeta(kopia.meta));
    }

    for (const rad of kopia.meta) {
      // The device identity is per installation and must not be overwritten by
      // a backup taken on another one.
      if (rad.key === 'deviceId') {
        continue;
      }
      await db.table<MetaRow, string>(META_TABLE).put(rad);
    }

    /*
     * Files first, then the log. An entry whose file has not arrived yet points
     * at nothing, and a restore that failed halfway should leave the evidence
     * ahead of the bookkeeping rather than behind it.
     */
    let nyaFiler = 0;
    const tabell = db.table<FilRad, Sha256>(FIL_TABLE);
    for (const fil of filer) {
      if ((await tabell.get(fil.sha256)) !== undefined) {
        continue;
      }
      await tabell.put(fil);
      nyaFiler += 1;
    }

    /*
     * A new device has made itself ready to book before anyone reaches the
     * restore screen. Folded into the backup, that starter set gave every
     * template twice; a device holding nothing else takes the books as they
     * were instead. Work done on the device is never dropped - see uppstart.ts.
     */
    if (kopia.handelser.length > 0 && (await harEnbartOskickadStartdata(db))) {
      await slappStartdata(db);
    }

    const nyaHandelser = await tillampaAlla(db, kopia.handelser);
    // Keep an idempotent restore alive until the transaction callback resolves,
    // including the case where tillampaAlla ended on a read of an existing id.
    await db.table(META_TABLE).get(BOK_ID_NYCKEL);
    return { nyaHandelser, nyaFiler };
  });
}

/** How many entries a backup holds, without applying any of them. */
export async function antalHandelser(db: BokfinkDatabase): Promise<number> {
  return db.table<Handelse, Uuid>(HANDELSE_TABLE).count();
}
