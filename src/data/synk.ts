import type { Handelse } from '../domain/handelse/handelse';
import type { Uuid } from '../domain/id/uuidv7';
import type { Sha256, Underlag } from '../domain/underlag/underlag';
import { lasLogg, tillampaAlla } from './bokforing';
import type { KonteraDatabase } from './db';
import { FIL_TABLE, HANDELSE_TABLE, SYNKKO_TABLE, UNDERLAG_TABLE } from './schema';
import { harEnbartOskickadStartdata, slappStartdata } from './uppstart';
import type { FilRad } from './underlag';

/**
 * Exchanging event logs between two devices, through a server that cannot
 * read them.
 *
 * The whole protocol is a union of two append-only logs (UTVECKLINGSPLAN
 * 3.1). There is no conflict resolution in the transport because there is
 * nothing to resolve: entries are immutable and identified by a UUIDv7, so
 * receiving one twice is a no-op and receiving them out of order is handled
 * by folding the log in id order - which the ledger already does.
 *
 * What the server stores is ciphertext. It is a postbox, not a database: it
 * holds envelopes, hands them back in the order they arrived, and can be
 * replaced by a dumber one without a single rule being lost.
 */

/** One entry as it lives on the server. */
export interface Fjarrpost {
  /** The entry's own UUIDv7. Unique on the server, which gives idempotence. */
  readonly op_id: Uuid;
  readonly device: string;
  /** The entry, encrypted. The server never sees bookkeeping. */
  readonly payload: string;
  /** The server's own timestamp, which is the marker for fetching. */
  readonly created: string;
  /**
   * The server's own identifier for the row.
   *
   * Not the entry's id: PocketBase gives every record a 15-character id of
   * its own, and it is that one the server can sort and paginate by. Absent
   * on the way up, since the server assigns it.
   */
  readonly id?: string;
}

/**
 * What the app needs from a server, and nothing more.
 *
 * Narrow on purpose: everything behind this interface can be replaced - the
 * plan requires that PocketBase be swappable for a dumb file store without a
 * rule being lost, and an interface with four methods is what makes that
 * claim checkable rather than aspirational.
 */
export interface Synktransport {
  /** Everything after the marker, oldest first. */
  hamta(efterMarkor: Markor | undefined): Promise<Fjarrpost[]>;
  /** Stores entries the server does not have. Duplicates are not an error. */
  skicka(poster: readonly Fjarrpost[]): Promise<void>;
  /**
   * Every content address the server holds a file for.
   *
   * A list rather than a lookup per file: the question asked on every sync is
   * "what is missing on either side", and one answer is cheaper than a
   * hundred questions. It also keeps the interface something a dumb file
   * store could satisfy by listing a directory.
   */
  filadresser(): Promise<readonly string[]>;
  /** Stores a file's ciphertext under its address. Already there is not an error. */
  skickaFil(adress: string, chiffer: Uint8Array): Promise<void>;
  /** The ciphertext for an address, or undefined when the server has none. */
  hamtaFil(adress: string): Promise<Uint8Array | undefined>;
}

/**
 * Where the last fetch stopped.
 *
 * Two entries can share a timestamp, so the id is part of the marker and the
 * server is asked to sort by both - paginating on a timestamp alone silently
 * skips whichever of the two came second (UTVECKLINGSPLAN 3.2).
 */
export interface Markor {
  readonly created: string;
  /** The server's own row id, which is what it can sort by. */
  readonly id: string;
}

export interface Krypto {
  kryptera(klartext: string): Promise<string>;
  dekryptera(chiffer: string): Promise<string>;
  /** The same key over bytes, for the files an underlag points at. */
  krypteraFil(data: Uint8Array): Promise<Uint8Array>;
  dekrypteraFil(chiffer: Uint8Array): Promise<Uint8Array>;
}

export interface Synkresultat {
  readonly skickade: number;
  readonly mottagna: number;
  /** Of the received entries, how many the books had not seen. */
  readonly nya: number;
  readonly filerSkickade: number;
  readonly filerMottagna: number;
  /**
   * Files the server had but whose bytes did not hash to the address they
   * were stored under.
   *
   * Counted rather than thrown, so one bad file does not stop the rest, and
   * reported rather than swallowed (hard rule 11): an underlag that does not
   * match its own checksum is not evidence of anything.
   */
  readonly filerAvvisade: number;
  /**
   * Entries the server turned away, which stay queued for the next round.
   *
   * Counted rather than thrown for the same reason as filerAvvisade: one
   * entry the server will not take must not hold up every other one, nor
   * stop this device from receiving what the other one booked. It was the
   * other way round until 2026-10-28, when a single entry over the server's
   * size limit stopped a phone from sending anything at all.
   */
  readonly avvisade: number;
  /** What the server said about the first of them, for the person to read. */
  readonly avvisningsorsak?: string;
}

/**
 * A transport's way of saying the server answered, and said no to this one.
 *
 * Distinct from a failure to reach the server. An unreachable server stops
 * the round, since every other entry would fail the same way; a refusal is
 * about one entry, and the rest are still worth sending.
 */
export class AvvisadError extends Error {
  constructor(meddelande: string) {
    super(meddelande);
    this.name = 'AvvisadError';
  }
}

const MARKOR_NYCKEL = 'synkmarkor';

/**
 * One round: send what is queued, then take everything new.
 *
 * Sending first is deliberate. A device that has been offline has work of its
 * own to contribute, and a pull that fails halfway should not leave that work
 * unsent - the queue is what makes the send safe to retry, and it is emptied
 * only for entries the server has confirmed.
 */
export async function synka(
  db: KonteraDatabase,
  transport: Synktransport,
  krypto: Krypto,
  enhet: string,
  { hasha }: { hasha: (data: Uint8Array) => Promise<Sha256> },
): Promise<Synkresultat> {
  await slappOrordStartdata(db, transport, krypto);
  const { skickade, avvisade, avvisningsorsak } = await skickaKon(
    db,
    transport,
    krypto,
    enhet,
  );
  const { mottagna, nya } = await hamtaNya(db, transport, krypto);
  const filer = await synkaFiler(db, transport, krypto, hasha);
  return {
    skickade,
    mottagna,
    nya,
    ...filer,
    avvisade,
    ...(avvisningsorsak === undefined ? {} : { avvisningsorsak }),
  };
}

/**
 * Lets a device nobody has used take the books it joins, rather than add to
 * them.
 *
 * Every device makes itself ready to book when it first starts: a year, the
 * starter accounts, seven templates. On the first device that is the start of
 * the books. On a second one, logged in to the sync afterwards, it is a copy
 * with other identifiers - and sent, it doubled every template on every
 * device, and put starter accounts and an empty year into the log after the
 * real ones, where they could replace imported names, SRU codes and opening
 * balances.
 *
 * So before its first round, a device whose log holds nothing but that
 * starter set, none of it ever sent, drops it if the server already has
 * books. Nothing is lost: those entries never left the device and describe
 * nothing anyone did, and the books arriving from the server carry their own
 * year, accounts and templates. The first device on an empty server keeps its
 * set, which is what starts the shared books.
 *
 * The server's first entry is decrypted before anything is dropped. A wrong
 * passphrase must fail with the device as it was, not with it emptied.
 */
async function slappOrordStartdata(
  db: KonteraDatabase,
  transport: Synktransport,
  krypto: Krypto,
): Promise<void> {
  if ((await db.getMeta<Markor>(MARKOR_NYCKEL)) !== undefined) {
    return;
  }
  if (!(await harEnbartOskickadStartdata(db))) {
    return;
  }

  const [forsta] = await transport.hamta(undefined);
  if (forsta === undefined) {
    return;
  }
  await krypto.dekryptera(forsta.payload);

  await slappStartdata(db);
}

/**
 * The files the entries point at, which the log itself does not carry.
 *
 * An underlag row is metadata; the bytes live beside the log, addressed by
 * their own hash (src/data/underlag.ts). That split is what keeps the log
 * small enough to replay and send - but it also means a synced device would
 * know about a receipt without being able to show it, which is half an
 * archive. So the files travel too, in their own round.
 *
 * Content addressing does the work here. Both sides name the same bytes the
 * same way, so the exchange is a set difference rather than a protocol, a
 * transfer interrupted halfway costs only the files it did not reach, and
 * running it again finishes the job.
 *
 * What comes back is hashed before it is stored. The address is a promise
 * about the content, and a file that does not keep it is not the receipt it
 * claims to be - bokföringslagen 7 kap. 1 § wants räkenskapsinformation kept
 * på betryggande sätt, which for a copy means checked rather than assumed.
 */
async function synkaFiler(
  db: KonteraDatabase,
  transport: Synktransport,
  krypto: Krypto,
  hasha: (data: Uint8Array) => Promise<Sha256>,
): Promise<Pick<Synkresultat, 'filerSkickade' | 'filerMottagna' | 'filerAvvisade'>> {
  const underlag = await db.table<Underlag, Uuid>(UNDERLAG_TABLE).toArray();
  if (underlag.length === 0) {
    return { filerSkickade: 0, filerMottagna: 0, filerAvvisade: 0 };
  }

  const filtabell = db.table<FilRad, Sha256>(FIL_TABLE);
  const lokala = new Set((await filtabell.toCollection().primaryKeys()) as Sha256[]);
  const paServern = new Set(await transport.filadresser());

  let filerSkickade = 0;
  let filerMottagna = 0;
  let filerAvvisade = 0;

  /*
   * Only what an underlag points at. A file nobody references is either on
   * its way to being collected or was never evidence, and either way it is
   * not something to spend the other device's storage on.
   */
  const adresser = [...new Set(underlag.map((post) => post.sha256))];

  for (const adress of adresser) {
    if (!lokala.has(adress) || paServern.has(adress)) {
      continue;
    }
    const rad = await filtabell.get(adress);
    if (rad === undefined) {
      continue;
    }
    await transport.skickaFil(adress, await krypto.krypteraFil(rad.data));
    filerSkickade += 1;
  }

  for (const adress of adresser) {
    if (lokala.has(adress) || !paServern.has(adress)) {
      continue;
    }
    const chiffer = await transport.hamtaFil(adress);
    if (chiffer === undefined) {
      continue;
    }
    /*
     * A file sent without a passphrase is its own bytes, and hashes to its
     * address as it is; one that does not is an envelope. The address
     * settles it, so no marker has to travel with the file.
     */
    const data =
      (await hasha(chiffer)) === adress ? chiffer : await krypto.dekrypteraFil(chiffer);
    if ((await hasha(data)) !== adress) {
      filerAvvisade += 1;
      continue;
    }

    // The mime type travels in the log, where the rest of the metadata is.
    const post = underlag.find((kandidat) => kandidat.sha256 === adress);
    if (post === undefined) {
      continue;
    }
    await filtabell.put({
      sha256: adress,
      mime: post.mime,
      storlek: data.byteLength,
      data,
    });
    filerMottagna += 1;
  }

  return { filerSkickade, filerMottagna, filerAvvisade };
}

/**
 * Forgets which server this device has talked to.
 *
 * Pointing the app at a new server is otherwise a quiet no-op: the queue only
 * holds what has never been sent, and a device that has synced once has an
 * empty one. It would log in to the new server, send nothing, receive
 * nothing, and report success - and the other device would do the same, both
 * believing they were in step while the new server stayed empty.
 *
 * So moving server means queueing the whole log again. The server's unique
 * index turns everything it already has into a no-op, which makes this safe
 * to do against the old server too.
 */
export async function glomServern(db: KonteraDatabase): Promise<void> {
  await db.setMeta(MARKOR_NYCKEL, undefined);
  const logg = await lasLogg(db);
  await db
    .table<{ id: Uuid }, Uuid>(SYNKKO_TABLE)
    .bulkPut(logg.map(({ id }) => ({ id })));
}

/** How many entries are waiting to be sent. */
export async function osankta(db: KonteraDatabase): Promise<number> {
  return db.table(SYNKKO_TABLE).count();
}

async function skickaKon(
  db: KonteraDatabase,
  transport: Synktransport,
  krypto: Krypto,
  enhet: string,
): Promise<Pick<Synkresultat, 'skickade' | 'avvisade' | 'avvisningsorsak'>> {
  const kade = await db.table<{ id: Uuid }, Uuid>(SYNKKO_TABLE).toArray();
  if (kade.length === 0) {
    return { skickade: 0, avvisade: 0 };
  }

  const logg = new Map((await lasLogg(db)).map((post) => [post.id, post]));
  let skickade = 0;
  let avvisade = 0;
  let avvisningsorsak: string | undefined;

  for (const { id } of kade) {
    const handelse = logg.get(id);
    if (handelse === undefined) {
      // Queued for an entry that is not in the log: nothing to send, and
      // nothing to keep waiting for either.
      await db.table(SYNKKO_TABLE).delete(id);
      continue;
    }

    /*
     * One at a time, and off the queue as soon as the server has it. A round
     * cut short by a lost connection then costs only what it did not reach,
     * rather than resending everything - which the unique index would turn
     * into no-ops, but only after paying for every request.
     */
    try {
      await transport.skicka([
        {
          op_id: handelse.id,
          device: enhet,
          payload: await krypto.kryptera(JSON.stringify(handelse)),
          created: '',
        },
      ]);
    } catch (orsak) {
      if (!(orsak instanceof AvvisadError)) {
        throw orsak;
      }
      avvisade += 1;
      avvisningsorsak ??= orsak.message;
      continue;
    }
    await db.table(SYNKKO_TABLE).delete(id);
    skickade += 1;
  }

  return {
    skickade,
    avvisade,
    ...(avvisningsorsak === undefined ? {} : { avvisningsorsak }),
  };
}

async function hamtaNya(
  db: KonteraDatabase,
  transport: Synktransport,
  krypto: Krypto,
): Promise<{ mottagna: number; nya: number }> {
  const markor = await db.getMeta<Markor>(MARKOR_NYCKEL);
  const poster = await transport.hamta(markor);
  if (poster.length === 0) {
    return { mottagna: 0, nya: 0 };
  }

  const handelser: Handelse[] = [];
  for (const post of poster) {
    handelser.push(JSON.parse(await krypto.dekryptera(post.payload)) as Handelse);
  }

  /*
   * Applied as remote, so they never join the queue to be sent back. Written
   * before the marker moves: a crash between the two costs a second fetch of
   * entries that are already applied, which is free, while the other order
   * would lose them.
   */
  const nya = await tillampaAlla(db, handelser, 'fjarr');
  await db.table(SYNKKO_TABLE).bulkDelete(handelser.map((post) => post.id));

  const sista = poster[poster.length - 1]!;
  await db.setMeta(MARKOR_NYCKEL, { created: sista.created, id: sista.id ?? '' });

  return { mottagna: poster.length, nya };
}

/** Everything in the log, for a device that is joining an existing set. */
export async function heltLoggutdrag(db: KonteraDatabase): Promise<number> {
  const logg = await lasLogg(db);
  await db
    .table<{ id: Uuid }, Uuid>(SYNKKO_TABLE)
    .bulkPut(logg.map((post) => ({ id: post.id })));
  return logg.length;
}

/** The marker, for showing how far a device has caught up. */
export async function synkmarkor(db: KonteraDatabase): Promise<Markor | undefined> {
  return db.getMeta<Markor>(MARKOR_NYCKEL);
}

/** Every entry id the log holds, used by tests and by a full resend. */
export async function loggidn(db: KonteraDatabase): Promise<Uuid[]> {
  return (await db.table<Handelse, Uuid>(HANDELSE_TABLE).toArray()).map(
    (post) => post.id,
  );
}
