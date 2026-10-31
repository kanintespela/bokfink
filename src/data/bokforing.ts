import {
  effekter,
  iLoggordning,
  type Bokforingstillstand,
  type Handelse,
  type Tillstandsuppslag,
} from '../domain/handelse/handelse';
import { omfattar, type Rakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import type { Konto, Kontonummer } from '../domain/konto/konto';
import type { Konteringsmall } from '../domain/mall/konteringsmall';
import type { Uuid } from '../domain/id/uuidv7';
import type { Anlaggningstillgang } from '../domain/anlaggning/anlaggningstillgang';
import type { Fastighetstillgang } from '../domain/anlaggning/fastighetstillgang';
import type { Djurlagerinventering } from '../domain/lager/djurlager';
import type { Projekt } from '../domain/projekt/projekt';
import type { Underlag } from '../domain/underlag/underlag';
import type {
  BokfortVerifikat,
  Rattelse,
  Verifikatutkast,
} from '../domain/verifikat/verifikat';
import type { KonteraDatabase } from './db';
import {
  ANLAGGNING_TABLE,
  DJURLAGER_TABLE,
  PROJEKT_TABLE,
  FASTIGHET_TABLE,
  HANDELSE_TABLE,
  KONTO_TABLE,
  MALL_TABLE,
  RAKENSKAPSAR_TABLE,
  SYNKKO_TABLE,
  UNDERLAG_TABLE,
  UTKAST_TABLE,
  VERIFIKAT_TABLE,
} from './schema';

/**
 * A booked verifikat as it is stored.
 *
 * `rakenskapsarId` is not part of the verifikat itself; it is an index key.
 * Hard rule 6 scopes the unbroken number series to a series *and* a fiscal
 * year, so the uniqueness constraint has to name the year, and IndexedDB can
 * only constrain fields that are actually on the row.
 */
export type VerifikatRad = BokfortVerifikat & { readonly rakenskapsarId: Uuid };

export class OforanderligtVerifikatError extends Error {
  constructor(id: Uuid) {
    super(
      `Verifikat ${id} är bokfört och kan inte ändras eller tas bort. ` +
        'Rätta med en annullering och ett nytt verifikat.',
    );
    this.name = 'OforanderligtVerifikatError';
  }
}

export class OkantRakenskapsarError extends Error {
  constructor(datum: string) {
    super(
      `Det finns inget räkenskapsår som omfattar ${datum}. Lägg upp året innan ` +
        'du bokför i det.',
    );
    this.name = 'OkantRakenskapsarError';
  }
}

/**
 * Refuses every update and delete on the verifikat table.
 *
 * Hard rule 5 and bokföringslagen 5 kap. 5 §. The domain already freezes a
 * booked verifikat, but a frozen object only stops the code holding it - the
 * table underneath would take a put() from anywhere. Dexie's hooks close that
 * door for every caller, including code written a year from now that has
 * forgotten the rule.
 *
 * Creating is allowed and correcting is done by writing a new verifikat, so
 * nothing legitimate needs the two operations this removes.
 */
export function skyddaBokfordaVerifikat(db: KonteraDatabase): void {
  const tabell = db.table<VerifikatRad, Uuid>(VERIFIKAT_TABLE);

  tabell.hook('updating', (andringar, nyckel, befintlig) => {
    const efter = { ...befintlig, ...(andringar as Partial<VerifikatRad>) };
    if (!barRattelse(befintlig, efter)) {
      throw new OforanderligtVerifikatError(nyckel);
    }
    // Allowed through unchanged; Dexie applies the modifications itself.
    return undefined;
  });

  tabell.hook('deleting', (nyckel) => {
    throw new OforanderligtVerifikatError(nyckel);
  });
}

/**
 * Whether a change to a booked verifikat is a correction and nothing else.
 *
 * The last gate before a row is overwritten, and deliberately not a repeat of
 * ratta's rules in another form: this compares the row on disk with the row
 * about to replace it, so it holds however the change arrived - a replayed
 * log, a sync from another device, or a future caller that has not been
 * written yet.
 *
 * Bokföringslagen 5 kap. 8 § permits the correction; what it does not permit
 * is an unrecorded one. Hence the last condition: a change is only a
 * correction if it leaves behind at least one more rättelse than it found, with
 * the earlier ones as they were: one per field corrected, so a description and
 * a date corrected together add two. Editing the description without recording
 * it fails here even though every other field would have passed.
 */
function barRattelse(fore: VerifikatRad, efter: VerifikatRad): boolean {
  return (
    fore.id === efter.id &&
    fore.status === efter.status &&
    fore.serie === efter.serie &&
    fore.nummer === efter.nummer &&
    fore.bokfortDatum === efter.bokfortDatum &&
    fore.rakenskapsarId === efter.rakenskapsarId &&
    fore.annullerar === efter.annullerar &&
    sammaPengarOchKonton(fore.konteringar, efter.konteringar) &&
    arTillagg(fore.rattelser ?? [], efter.rattelser ?? []) &&
    projektenArRattade(fore, efter)
  );
}

/**
 * Whether the rows are the same rows: the same accounts, amounts and notes in
 * the same order. A rad's project is not part of it, as it may be corrected.
 */
function sammaPengarOchKonton(
  fore: VerifikatRad['konteringar'],
  efter: VerifikatRad['konteringar'],
): boolean {
  // Every field but the project, so a field added to a rad later is guarded too.
  const utanProjekt = (rader: VerifikatRad['konteringar']) =>
    JSON.stringify(
      rader.map((rad) => Object.entries(rad).filter(([falt]) => falt !== 'projekt')),
    );
  return fore.length === efter.length && utanProjekt(fore) === utanProjekt(efter);
}

/**
 * Whether every rad whose project differs has a rättelse of its own in what
 * `efter` added, saying what it held and what it holds now. A project changed
 * with nothing recorded is as unrecorded as a description changed with nothing
 * recorded.
 */
function projektenArRattade(fore: VerifikatRad, efter: VerifikatRad): boolean {
  const nya = (efter.rattelser ?? []).slice((fore.rattelser ?? []).length);
  return fore.konteringar.every((rad, index) => {
    const nu = efter.konteringar[index]?.projekt;
    if (rad.projekt === nu) {
      return true;
    }
    return nya.some(
      (post) =>
        post.falt === 'projekt' &&
        post.rad === index &&
        post.fran === (rad.projekt ?? '') &&
        post.till === (nu ?? ''),
    );
  });
}

/** Whether `efter` is `fore` with at least one rättelse added at the end. */
function arTillagg(fore: readonly Rattelse[], efter: readonly Rattelse[]): boolean {
  return (
    efter.length > fore.length &&
    JSON.stringify(efter.slice(0, fore.length)) === JSON.stringify(fore)
  );
}

/**
 * Writes one log entry and the rows it changes, atomically.
 *
 * The log and its views must never disagree, so both go in one Dexie
 * transaction: either the entry and every row it implies land together, or
 * neither does. A view that had drifted from the log would be undetectable
 * without a full rebuild, which is exactly the failure this prevents.
 *
 * Applying an entry twice is a no-op rather than an error, because a sync
 * will legitimately deliver one twice.
 */
export async function tillampa(
  db: KonteraDatabase,
  handelse: Handelse,
  ursprung: Ursprung = 'lokal',
): Promise<boolean> {
  return db.transaction(
    'rw',
    [
      db.table(HANDELSE_TABLE),
      db.table(KONTO_TABLE),
      db.table(RAKENSKAPSAR_TABLE),
      db.table(UTKAST_TABLE),
      db.table(VERIFIKAT_TABLE),
      db.table(MALL_TABLE),
      db.table(UNDERLAG_TABLE),
      db.table(SYNKKO_TABLE),
      db.table(ANLAGGNING_TABLE),
      db.table(FASTIGHET_TABLE),
      db.table(DJURLAGER_TABLE),
      db.table(PROJEKT_TABLE),
    ],
    async () => {
      const redanTillampad = await db.table(HANDELSE_TABLE).get(handelse.id);
      if (redanTillampad !== undefined) {
        return false;
      }

      const uppslag = await laddaUppslag(db, handelse);

      for (const effekt of effekter(handelse, uppslag)) {
        switch (effekt.tabell) {
          case 'konto':
            await db.table<Konto, Kontonummer>(KONTO_TABLE).put(effekt.post);
            break;
          case 'rakenskapsar':
            if (effekt.atgard === 'satt') {
              await db.table<Rakenskapsar, Uuid>(RAKENSKAPSAR_TABLE).put(effekt.post);
            } else {
              await db.table<Rakenskapsar, Uuid>(RAKENSKAPSAR_TABLE).delete(effekt.id);
            }
            break;
          case 'utkast':
            if (effekt.atgard === 'satt') {
              await db.table<Verifikatutkast, Uuid>(UTKAST_TABLE).put(effekt.post);
            } else {
              await db.table<Verifikatutkast, Uuid>(UTKAST_TABLE).delete(effekt.id);
            }
            break;
          case 'mall':
            if (effekt.atgard === 'satt') {
              await db.table<Konteringsmall, Uuid>(MALL_TABLE).put(effekt.post);
            } else {
              await db.table<Konteringsmall, Uuid>(MALL_TABLE).delete(effekt.id);
            }
            break;
          case 'underlag':
            if (effekt.atgard === 'satt') {
              await db.table<Underlag, Uuid>(UNDERLAG_TABLE).put(effekt.post);
            } else {
              await db.table<Underlag, Uuid>(UNDERLAG_TABLE).delete(effekt.id);
            }
            break;
          case 'verifikat': {
            const ar = await hittaRakenskapsar(db, effekt.post.datum);
            const rad = { ...effekt.post, rakenskapsarId: ar.id };
            const tabell = db.table<VerifikatRad, Uuid>(VERIFIKAT_TABLE);
            // add() refuses an id that is already there, which is what catches
            // a double booking; a correction is the one case meant to replace.
            await (effekt.atgard === 'ratta' ? tabell.put(rad) : tabell.add(rad));
            break;
          }
          case 'anlaggning':
            await db.table<Anlaggningstillgang, Uuid>(ANLAGGNING_TABLE).put(effekt.post);
            break;
          case 'fastighet':
            await db.table<Fastighetstillgang, Uuid>(FASTIGHET_TABLE).put(effekt.post);
            break;
          case 'djurlager':
            await db.table<Djurlagerinventering, Uuid>(DJURLAGER_TABLE).put(effekt.post);
            break;
          case 'projekt':
            await db.table<Projekt, Uuid>(PROJEKT_TABLE).put(effekt.post);
            break;
        }
      }

      await db.table(HANDELSE_TABLE).add(handelse);
      if (ursprung === 'lokal') {
        // Written here, sent later. An entry that came from the server is
        // already there and never joins the queue.
        await db.table<{ id: Uuid }, Uuid>(SYNKKO_TABLE).put({ id: handelse.id });
      }
      return true;
    },
  );
}

/**
 * Where an entry came from.
 *
 * The only thing the log itself cannot tell afterwards, and the only thing
 * the sync queue needs to know.
 */
export type Ursprung = 'lokal' | 'fjarr';

/** Applies a run of entries in log order. Returns how many were new. */
export async function tillampaAlla(
  db: KonteraDatabase,
  handelser: Iterable<Handelse>,
  ursprung: Ursprung = 'lokal',
): Promise<number> {
  let nya = 0;
  for (const handelse of iLoggordning(handelser)) {
    if (await tillampa(db, handelse, ursprung)) {
      nya += 1;
    }
  }
  return nya;
}

/** Every entry, in the order it was made. */
export async function lasLogg(db: KonteraDatabase): Promise<Handelse[]> {
  // The primary key is a UUIDv7, so key order is chronological order.
  return db.table<Handelse, Uuid>(HANDELSE_TABLE).orderBy(':id').toArray();
}

/** The materialised tables, in the shape the domain describes them. */
export async function lasTillstand(db: KonteraDatabase): Promise<Bokforingstillstand> {
  const [
    konton,
    rakenskapsar,
    utkast,
    verifikat,
    mallar,
    underlag,
    anlaggningar,
    fastigheter,
    djurlagerinventeringar,
    projekt,
  ] = await Promise.all([
    db.table<Konto, Kontonummer>(KONTO_TABLE).toArray(),
    db.table<Rakenskapsar, Uuid>(RAKENSKAPSAR_TABLE).toArray(),
    db.table<Verifikatutkast, Uuid>(UTKAST_TABLE).toArray(),
    db.table<VerifikatRad, Uuid>(VERIFIKAT_TABLE).toArray(),
    db.table<Konteringsmall, Uuid>(MALL_TABLE).toArray(),
    db.table<Underlag, Uuid>(UNDERLAG_TABLE).toArray(),
    db.table<Anlaggningstillgang, Uuid>(ANLAGGNING_TABLE).toArray(),
    db.table<Fastighetstillgang, Uuid>(FASTIGHET_TABLE).toArray(),
    db.table<Djurlagerinventering, Uuid>(DJURLAGER_TABLE).toArray(),
    db.table<Projekt, Uuid>(PROJEKT_TABLE).toArray(),
  ]);

  return {
    konton: new Map(konton.map((konto) => [konto.nummer, konto])),
    rakenskapsar: new Map(rakenskapsar.map((ar) => [ar.id, ar])),
    utkast: new Map(utkast.map((post) => [post.id, post])),
    verifikat: new Map(verifikat.map((rad) => [rad.id, utanIndexnyckel(rad)])),
    mallar: new Map(mallar.map((mall) => [mall.id, mall])),
    underlag: new Map(underlag.map((post) => [post.id, post])),
    anlaggningar: new Map(anlaggningar.map((post) => [post.id, post])),
    fastigheter: new Map(fastigheter.map((post) => [post.id, post])),
    djurlagerinventeringar: new Map(
      djurlagerinventeringar.map((post) => [post.id, post]),
    ),
    projekt: new Map(projekt.map((post) => [post.id, post])),
  };
}

/**
 * Drops the index key on the way back out.
 *
 * rakenskapsarId exists so IndexedDB has something to constrain; it is not
 * part of a verifikat, and letting it leak into the domain would make the
 * tables and the log compare unequal for a reason that has nothing to do
 * with the bookkeeping. Written out field by field rather than deleted from
 * a copy, so that adding a field to BokfortVerifikat fails here loudly
 * instead of silently dropping it.
 */
function utanIndexnyckel(rad: VerifikatRad): BokfortVerifikat {
  /*
   * Frozen on the way out as well as on the way in. bokfor freezes what it
   * produces, but a row read back from IndexedDB is a fresh mutable object,
   * and code that had learned to rely on a booked verifikat being immutable
   * would quietly stop being protected the moment it read one from storage.
   */
  return Object.freeze({
    status: rad.status,
    id: rad.id,
    serie: rad.serie,
    nummer: rad.nummer,
    datum: rad.datum,
    bokfortDatum: rad.bokfortDatum,
    beskrivning: rad.beskrivning,
    konteringar: Object.freeze(rad.konteringar.map((post) => Object.freeze({ ...post }))),
    kalla: rad.kalla,
    ...(rad.annullerar === undefined ? {} : { annullerar: rad.annullerar }),
    ...(rad.mall === undefined ? {} : { mall: rad.mall }),
    ...(rad.rattelser === undefined
      ? {}
      : {
          rattelser: Object.freeze(
            rad.rattelser.map((post) => Object.freeze({ ...post })),
          ),
        }),
  });
}

/** A booked verifikat with what the ledger knows about it besides itself. */
export interface Verifikatpost {
  readonly verifikat: BokfortVerifikat;
  readonly rakenskapsarId: Uuid;
  /** The verifikat that reversed this one, when one did. */
  readonly annulleratAv?: BokfortVerifikat;
}

/**
 * Reads a fiscal year's verifikat, newest first.
 *
 * Read through the index rather than by loading the ledger, because this is
 * the list someone scrolls: it has to stay quick when four years of history
 * have been imported and more is added every week.
 *
 * The reverse link is resolved here. A booked verifikat is frozen and cannot
 * record that something annulled it, so the answer lives in the annullerar
 * index and is joined on the way out.
 */
export async function lasVerifikat(
  db: KonteraDatabase,
  rakenskapsarId: Uuid,
): Promise<Verifikatpost[]> {
  const tabell = db.table<VerifikatRad, Uuid>(VERIFIKAT_TABLE);

  const rader = await tabell
    .where('[rakenskapsarId+serie+nummer]')
    .between(
      [rakenskapsarId, '', Number.MIN_SAFE_INTEGER],
      [rakenskapsarId, '\uffff', Number.MAX_SAFE_INTEGER],
    )
    .toArray();

  const annulleringar = new Map<Uuid, BokfortVerifikat>();
  for (const rad of rader) {
    if (rad.annullerar !== undefined) {
      annulleringar.set(rad.annullerar, utanIndexnyckel(rad));
    }
  }

  return rader
    .map((rad): Verifikatpost => {
      const annulleratAv = annulleringar.get(rad.id);
      return {
        verifikat: utanIndexnyckel(rad),
        rakenskapsarId: rad.rakenskapsarId,
        ...(annulleratAv === undefined ? {} : { annulleratAv }),
      };
    })
    .sort(senastForst);
}

/**
 * The verifikat among `poster` that was booked last.
 *
 * Not the first row of the verifikationslista. That list is in number order
 * per series, and series sort by name, so with two series - one imported or
 * booked on another device, one this device books in - the top row is the
 * highest number of whichever series is alphabetically first, however old.
 * Neither the number nor bokfortDatum can say which came last across series;
 * the log can, because an entry's id is a UUIDv7 and so orders by the moment
 * it was made, wherever it was made and in whatever order a sync delivered it.
 */
export async function senastBokfort(
  db: KonteraDatabase,
  poster: readonly Verifikatpost[],
): Promise<Verifikatpost | undefined> {
  return (await senastBokforda(db, poster, 1))[0];
}

/** The last `antal` booked among `poster`, the latest first. See senastBokfort. */
export async function senastBokforda(
  db: KonteraDatabase,
  poster: readonly Verifikatpost[],
  antal: number,
): Promise<Verifikatpost[]> {
  const perId = new Map(poster.map((post) => [post.verifikat.id, post]));
  if (perId.size === 0 || antal <= 0) {
    return [];
  }

  const bokforingar = await db
    .table<Handelse, Uuid>(HANDELSE_TABLE)
    .where('typ')
    .equals('verifikat.bokfort')
    .toArray();

  const traffar: { handelseId: Uuid; post: Verifikatpost }[] = [];
  for (const handelse of bokforingar) {
    if (handelse.typ !== 'verifikat.bokfort') {
      continue;
    }
    const post = perId.get(handelse.verifikat.id);
    if (post !== undefined) {
      traffar.push({ handelseId: handelse.id, post });
    }
  }
  return traffar
    .sort((a, b) =>
      a.handelseId < b.handelseId ? 1 : a.handelseId > b.handelseId ? -1 : 0,
    )
    .slice(0, antal)
    .map(({ post }) => post);
}

function senastForst(a: Verifikatpost, b: Verifikatpost): number {
  if (a.verifikat.serie !== b.verifikat.serie) {
    return a.verifikat.serie.localeCompare(b.verifikat.serie);
  }
  return b.verifikat.nummer - a.verifikat.nummer;
}

/**
 * Reads just the rows the entry needs before it can say what it changes.
 *
 * One row rather than the ledger: the domain's Tillstandsuppslag is narrow
 * precisely so that this stays cheap.
 */
async function laddaUppslag(
  db: KonteraDatabase,
  handelse: Handelse,
): Promise<Tillstandsuppslag> {
  const arPoster = new Map<Uuid, Rakenskapsar>();
  const verifikatPoster = new Map<Uuid, BokfortVerifikat>();
  const utkastposter = new Map<Uuid, Verifikatutkast>();
  const underlagsposter = new Map<Uuid, Underlag>();
  const anlaggningsposter = new Map<Uuid, Anlaggningstillgang>();
  const fastighetsposter = new Map<Uuid, Fastighetstillgang>();
  const djurlagerposter = new Map<Uuid, Djurlagerinventering>();
  const projektposter = new Map<Uuid, Projekt>();

  if (
    handelse.typ === 'rakenskapsar.momslast' ||
    handelse.typ === 'rakenskapsar.avslutat' ||
    handelse.typ === 'rakenskapsar.ingaendebalanser'
  ) {
    const ar = await db
      .table<Rakenskapsar, Uuid>(RAKENSKAPSAR_TABLE)
      .get(handelse.rakenskapsarId);
    if (ar !== undefined) {
      arPoster.set(ar.id, ar);
    }
  }

  if (handelse.typ === 'verifikat.bokfort' || handelse.typ === 'verifikat.rattat') {
    const id =
      handelse.typ === 'verifikat.bokfort' ? handelse.verifikat.id : handelse.verifikatId;
    const befintligt = await db.table<VerifikatRad, Uuid>(VERIFIKAT_TABLE).get(id);
    if (befintligt !== undefined) {
      // Stripped of its index key: a correction is applied to the verifikat,
      // not to the row, and the key is put back on the way in.
      verifikatPoster.set(befintligt.id, utanIndexnyckel(befintligt));
    }
  }

  if (
    handelse.typ === 'underlag.tillagt' ||
    handelse.typ === 'underlag.kopplat' ||
    handelse.typ === 'underlag.frikopplat' ||
    handelse.typ === 'underlag.avlast' ||
    handelse.typ === 'underlag.forfallodag' ||
    handelse.typ === 'underlag.borttaget'
  ) {
    const id =
      handelse.typ === 'underlag.tillagt' ? handelse.underlag.id : handelse.underlagId;
    const post = await db.table<Underlag, Uuid>(UNDERLAG_TABLE).get(id);
    if (post !== undefined) {
      underlagsposter.set(post.id, post);
    }

    /*
     * Whether what the receipt is linked to, or is being linked to, is a
     * draft - the difference between a picture and evidence when it is
     * thrown away, and between a conflict and nothing when the receipt is
     * already gone.
     */
    const lankar =
      handelse.typ === 'underlag.kopplat'
        ? [handelse.verifikatId]
        : handelse.typ === 'underlag.borttaget'
          ? (post?.verifikat ?? [])
          : [];
    for (const lank of lankar) {
      const utkast = await db.table<Verifikatutkast, Uuid>(UTKAST_TABLE).get(lank);
      if (utkast !== undefined) {
        utkastposter.set(utkast.id, utkast);
      }
    }
  }

  if (
    handelse.typ === 'anlaggning.registrerad' ||
    handelse.typ === 'anlaggning.avyttrad'
  ) {
    const id =
      handelse.typ === 'anlaggning.registrerad'
        ? handelse.tillgang.id
        : handelse.tillgangId;
    const post = await db.table<Anlaggningstillgang, Uuid>(ANLAGGNING_TABLE).get(id);
    if (post !== undefined) {
      anlaggningsposter.set(post.id, post);
    }
  }

  if (
    handelse.typ === 'fastighet.registrerad' ||
    handelse.typ === 'fastighet.avyttrad' ||
    handelse.typ === 'fastighet.avskrivningBokford'
  ) {
    const id =
      handelse.typ === 'fastighet.registrerad'
        ? handelse.tillgang.id
        : handelse.tillgangId;
    const post = await db.table<Fastighetstillgang, Uuid>(FASTIGHET_TABLE).get(id);
    if (post !== undefined) {
      fastighetsposter.set(post.id, post);
    }
  }

  if (handelse.typ === 'djurlager.inventerat') {
    const post = await db
      .table<Djurlagerinventering, Uuid>(DJURLAGER_TABLE)
      .get(handelse.inventering.id);
    if (post !== undefined) {
      djurlagerposter.set(post.id, post);
    }
  }

  if (handelse.typ === 'projekt.skapat' || handelse.typ === 'projekt.andrat') {
    const id =
      handelse.typ === 'projekt.skapat' ? handelse.projekt.id : handelse.projektId;
    const post = await db.table<Projekt, Uuid>(PROJEKT_TABLE).get(id);
    if (post !== undefined) {
      projektposter.set(post.id, post);
    }
  }

  return {
    rakenskapsar: (id) => arPoster.get(id),
    verifikat: (id) => verifikatPoster.get(id),
    utkast: (id) => utkastposter.get(id),
    underlag: (id) => underlagsposter.get(id),
    anlaggning: (id) => anlaggningsposter.get(id),
    fastighet: (id) => fastighetsposter.get(id),
    djurlager: (id) => djurlagerposter.get(id),
    projekt: (id) => projektposter.get(id),
  };
}

async function hittaRakenskapsar(
  db: KonteraDatabase,
  datum: string,
): Promise<Rakenskapsar> {
  const kandidater = await db
    .table<Rakenskapsar, Uuid>(RAKENSKAPSAR_TABLE)
    .where('start')
    .belowOrEqual(datum)
    .toArray();

  const ar = kandidater.find((kandidat) =>
    omfattar(kandidat, datum as Rakenskapsar['start']),
  );
  if (ar === undefined) {
    throw new OkantRakenskapsarError(datum);
  }
  return ar;
}
