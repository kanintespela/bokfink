import type { Handelse } from '../domain/handelse/handelse';
import type { Uuid } from '../domain/id/uuidv7';
import type { Konto } from '../domain/konto/konto';
import type { Konteringsmall } from '../domain/mall/konteringsmall';
import {
  kodenFinns,
  OgiltigtProjektError,
  skapaProjekt,
  type Projekt,
} from '../domain/projekt/projekt';
import { paverkarMomsdeklarationen } from '../domain/moms/momsrapport';
import {
  kontrolleraBokforingsbart,
  kontrolleraInteFramtida,
  omfattar,
  PeriodLastError,
  type Ingaendebalans,
  type Rakenskapsar,
} from '../domain/rakenskapsar/rakenskapsar';
import type { Datum } from '../domain/tid/datum';
import { nastaVerifikationsnummer, type Verifikatserie } from '../domain/verifikat/serie';
import {
  annullera,
  beteckning,
  bokfor,
  ratta,
  type BokfortVerifikat,
  type Projektrattelse,
  type Verifikatkalla,
  type Verifikatutkast,
} from '../domain/verifikat/verifikat';
import { lasLogg, lasTillstand, tillampa, type VerifikatRad } from './bokforing';
import type { KonteraDatabase } from './db';
import { newIdentifier } from './id';
import { PROJEKT_TABLE, RAKENSKAPSAR_TABLE, VERIFIKAT_TABLE } from './schema';

/**
 * What every command needs before it can write to the log: which device is
 * writing, and when.
 *
 * Both are injected rather than read here, so a test can produce the same
 * log twice and a replay is reproducible.
 */
export interface Skrivkontext {
  readonly enhet: string;
  readonly nu: () => string;
  readonly nyttId?: () => Uuid;
  /**
   * Today in Europe/Stockholm, when the writer knows it.
   *
   * Given, booking refuses a date after it. Every screen passes it; a test
   * that books into a fixed year without caring what today is may leave it
   * out.
   */
  readonly idag?: () => Datum;
}

/** A fresh identifier from whatever source the context provides. */
export function nyttId(kontext: Skrivkontext): Uuid {
  return (kontext.nyttId ?? newIdentifier)();
}

/** The fields every log entry carries, filled in from the context. */
export function huvud(kontext: Skrivkontext) {
  return { id: nyttId(kontext), enhet: kontext.enhet, tidpunkt: kontext.nu() };
}

export async function skrivKonto(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  konto: Konto,
  finnsSedanTidigare = false,
): Promise<void> {
  const handelse: Handelse = finnsSedanTidigare
    ? { ...huvud(kontext), typ: 'konto.andrat', konto }
    : { ...huvud(kontext), typ: 'konto.skapat', konto };
  await tillampa(db, handelse);
}

export async function skrivRakenskapsar(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  rakenskapsar: Rakenskapsar,
): Promise<void> {
  await tillampa(db, { ...huvud(kontext), typ: 'rakenskapsar.skapat', rakenskapsar });
}

export class OkantProjektError extends Error {
  constructor(projektId: Uuid) {
    super(`Projektet ${projektId} finns inte i den här boken.`);
    this.name = 'OkantProjektError';
  }
}

export class AvslutatProjektError extends Error {
  constructor(projekt: Projekt) {
    super(
      `Projektet ${projekt.kod} (${projekt.namn}) är avslutat och tar inga fler ` +
        'bokningar. Öppna det igen om något ska bokföras på det.',
    );
    this.name = 'AvslutatProjektError';
  }
}

/**
 * Whether every project a line points at exists, and is still open.
 *
 * Checked where lines are saved and booked, because the domain has no register
 * to look in. A reversal is let through for a project that has since been
 * finished: undoing a booking is not a new booking on the project, and refusing
 * it would leave a mistake on a finished project with no way to correct it.
 */
async function kontrolleraProjekt(
  db: KonteraDatabase,
  projektIdn: Iterable<Uuid>,
  tillatAvslutat = false,
): Promise<void> {
  for (const projektId of new Set(projektIdn)) {
    const projekt = await db.table<Projekt, Uuid>(PROJEKT_TABLE).get(projektId);
    if (projekt === undefined) {
      throw new OkantProjektError(projektId);
    }
    if (projekt.avslutat && !tillatAvslutat) {
      throw new AvslutatProjektError(projekt);
    }
  }
}

/** Creates a project. Its code is how it is told apart in a file, so no two share one. */
export async function skrivProjekt(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  uppgifter: { readonly kod: string; readonly namn: string },
): Promise<Projekt> {
  const finns = await db.table<Projekt, Uuid>(PROJEKT_TABLE).toArray();
  if (kodenFinns(uppgifter.kod, finns)) {
    throw new OgiltigtProjektError(
      `Det finns redan ett projekt med koden ${uppgifter.kod.trim()}.`,
    );
  }
  const projekt = skapaProjekt({ id: nyttId(kontext), ...uppgifter });
  await tillampa(db, { ...huvud(kontext), typ: 'projekt.skapat', projekt });
  return projekt;
}

/** Renames a project, or finishes or reopens it. The code stays. */
export async function andraProjektet(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  projektId: Uuid,
  andring: { readonly namn?: string; readonly avslutat?: boolean },
): Promise<void> {
  await tillampa(db, {
    ...huvud(kontext),
    typ: 'projekt.andrat',
    projektId,
    ...(andring.namn === undefined ? {} : { namn: andring.namn }),
    ...(andring.avslutat === undefined ? {} : { avslutat: andring.avslutat }),
  });
}

export async function sparaUtkast(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  utkast: Verifikatutkast,
): Promise<void> {
  await kontrolleraProjekt(
    db,
    utkast.konteringar.flatMap((rad) => rad.projekt ?? []),
  );
  await tillampa(db, { ...huvud(kontext), typ: 'utkast.sparat', utkast });
}

export async function taBortUtkast(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  utkastId: Uuid,
): Promise<void> {
  await tillampa(db, { ...huvud(kontext), typ: 'utkast.borttaget', utkastId });
}

export async function momslas(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  rakenskapsarId: Uuid,
  tom: Datum,
): Promise<void> {
  await tillampa(db, {
    ...huvud(kontext),
    typ: 'rakenskapsar.momslast',
    rakenskapsarId,
    tom,
  });
}

export async function sattIngaendeBalanser(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  rakenskapsarId: Uuid,
  balanser: readonly Ingaendebalans[],
): Promise<void> {
  await tillampa(db, {
    ...huvud(kontext),
    typ: 'rakenskapsar.ingaendebalanser',
    rakenskapsarId,
    balanser,
  });
}

export async function avslutaRakenskapsar(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  rakenskapsarId: Uuid,
): Promise<void> {
  await tillampa(db, {
    ...huvud(kontext),
    typ: 'rakenskapsar.avslutat',
    rakenskapsarId,
  });
}

export class TomtArKravsError extends Error {
  constructor(readonly rakenskapsarId: Uuid) {
    super(
      'Räkenskapsåret innehåller bokföring och kan inte tas bort. ' +
        'Räkenskapsinformation ska bevaras i sju år (bokföringslagen 7 kap. 2 §).',
    );
    this.name = 'TomtArKravsError';
  }
}

export class EndaAretError extends Error {
  constructor(readonly rakenskapsarId: Uuid) {
    super(
      'Det här är det enda räkenskapsåret med sin startdag. Bara en dubblett ' +
        'går att ta bort — annars skulle bokföringen bli utan år att bokföra i.',
    );
    this.name = 'EndaAretError';
  }
}

/**
 * Removes a fiscal year that never held anything.
 *
 * The only removal the books allow, and it exists because of a mistake the
 * app used to make: two devices that both started out empty each created
 * their own "year that covers today", and after a sync one calendar year sat
 * there twice. The identifiers are derived from the start date now
 * (src/domain/rakenskapsar/rakenskapsar.ts), so no new pair appears - but the
 * pairs already in the log are in the log, and one of them has to be able to
 * go.
 *
 * Refused the moment the year holds a verifikat or an opening balance. That
 * is bookkeeping, and bokföringslagen 7 kap. 2 § keeps it for seven years; a
 * year with nothing in it is a row that exists by accident.
 */
export async function taBortRakenskapsar(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  rakenskapsarId: Uuid,
): Promise<void> {
  const tillstand = await lasTillstand(db);
  const ar = tillstand.rakenskapsar.get(rakenskapsarId);
  if (ar === undefined) {
    return;
  }

  /*
   * By year, not by date. The two halves of a doubled year cover exactly the
   * same days, so asking "is anything booked between these dates" answers yes
   * for the empty one as well and nothing could ever be removed.
   */
  const harVerifikat = await db
    .table<VerifikatRad, Uuid>(VERIFIKAT_TABLE)
    .filter((rad) => rad.rakenskapsarId === rakenskapsarId)
    .count();
  if (harVerifikat > 0 || ar.ingaendeBalanser.length > 0 || ar.avslutat) {
    throw new TomtArKravsError(rakenskapsarId);
  }

  /*
   * Only ever one of a pair. Removing the last year that covers a date would
   * leave the app with nowhere to book, and uppstart would create it again
   * with the same derived identifier - which now sorts before the removal,
   * so the year would stay gone and keep being recreated. A duplicate is the
   * only case this is for, and the only one it allows.
   */
  const finnsDubblett = [...tillstand.rakenskapsar.values()].some(
    (annat) => annat.id !== ar.id && annat.start === ar.start,
  );
  if (!finnsDubblett) {
    throw new EndaAretError(rakenskapsarId);
  }

  await tillampa(db, {
    ...huvud(kontext),
    typ: 'rakenskapsar.borttaget',
    rakenskapsarId,
  });
}

/**
 * The years a removal would accept, worked out the same way the command does.
 *
 * Exported so the screen can offer the button for exactly those and no
 * others. One rule, one place: a screen that decided this for itself would
 * drift from the command the first time either changed.
 */
export async function borttagbaraRakenskapsar(
  db: KonteraDatabase,
): Promise<ReadonlySet<Uuid>> {
  const tillstand = await lasTillstand(db);
  const aren = [...tillstand.rakenskapsar.values()];
  const medVerifikat = new Set(
    (await db.table<VerifikatRad, Uuid>(VERIFIKAT_TABLE).toArray()).map(
      (rad) => rad.rakenskapsarId,
    ),
  );

  return new Set(
    aren
      .filter(
        (ar) =>
          !ar.avslutat &&
          ar.ingaendeBalanser.length === 0 &&
          !medVerifikat.has(ar.id) &&
          aren.some((annat) => annat.id !== ar.id && annat.start === ar.start),
      )
      .map((ar) => ar.id),
  );
}

export async function sparaMall(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  mall: Konteringsmall,
): Promise<void> {
  await tillampa(db, { ...huvud(kontext), typ: 'mall.sparad', mall });
}

export async function taBortMall(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  mallId: Uuid,
): Promise<void> {
  await tillampa(db, { ...huvud(kontext), typ: 'mall.borttagen', mallId });
}

/**
 * How often each template has actually been used, counted from the log.
 *
 * This is the whole ranking signal. It costs a pass over the log rather than
 * a tally kept alongside it, which is the trade the append-only design asks
 * for: a counter could fall out of step with the entries it counts, a pass
 * cannot.
 */
export async function mallanvandning(db: KonteraDatabase): Promise<Map<Uuid, number>> {
  const antal = new Map<Uuid, number>();
  for (const handelse of await lasLogg(db)) {
    if (handelse.typ === 'verifikat.bokfort' && handelse.verifikat.mall !== undefined) {
      const id = handelse.verifikat.mall;
      antal.set(id, (antal.get(id) ?? 0) + 1);
    }
  }
  return antal;
}

/**
 * Books a draft: finds its fiscal year, checks the period is open, hands out
 * the next number in the series and writes the entry.
 *
 * The number is issued here rather than in the domain because only the
 * database knows what has already been handed out. The unique index on
 * [rakenskapsarId+serie+nummer] is the backstop if two writes ever race:
 * one fails rather than both succeeding with the same number.
 */
export async function bokforUtkast(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  utkast: Verifikatutkast,
  serie: Verifikatserie,
  kalla: Verifikatkalla = 'manuell',
): Promise<BokfortVerifikat> {
  if (kontext.idag !== undefined) {
    kontrolleraInteFramtida(utkast.datum, kontext.idag());
  }
  const ar = await hittaAr(db, utkast.datum);
  kontrolleraBokforingsbart(
    ar,
    utkast.datum,
    paverkarMomsdeklarationen(utkast.konteringar),
  );
  await kontrolleraProjekt(
    db,
    utkast.konteringar.flatMap((rad) => rad.projekt ?? []),
    utkast.annullerar !== undefined,
  );

  const verifikat = bokfor(utkast, {
    serie,
    nummer: nastaVerifikationsnummer(await hogstaNummer(db, ar.id, serie)),
    bokfortDatum: utkast.datum,
    kalla,
  });

  await tillampa(db, { ...huvud(kontext), typ: 'verifikat.bokfort', verifikat });
  return verifikat;
}

/**
 * Corrects what a booked verifikat says, without touching what it does.
 *
 * Bokföringslagen 5 kap. 8 § allows a verifikation to be corrected as long as
 * it is recorded when and by whom; the log entry is that record. Only the
 * description and the date can move - see ratta.
 *
 * A date is the harder of the two, and three things have to hold:
 *
 *   - the old period must still be open. Moving an entry out of a filed
 *     momsdeklaration changes a figure already reported just as surely as
 *     moving one into it, and only checking the new date would allow exactly
 *     that.
 *   - the new date must be bookable, by the same gate a new entry passes.
 *   - both must fall in the same räkenskapsår. The verifikationsnummer is
 *     unique per serie and year (hard rule 6), so a date that crosses a year
 *     boundary would carry a number belonging to the other year's series.
 */
export async function rattaVerifikat(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  original: BokfortVerifikat,
  andring: {
    readonly beskrivning?: string;
    readonly datum?: Datum;
    readonly projekt?: readonly Projektrattelse[];
  },
): Promise<BokfortVerifikat> {
  const gammaltAr = await hittaAr(db, original.datum);

  /*
   * A project may be taken off a row, or kept where it is, whether the project
   * is finished or not; one put on a row must be there and be open, the same as
   * when a row is saved. A rad that already has the project is not put on it.
   */
  await kontrolleraProjekt(
    db,
    (andring.projekt ?? []).flatMap((rattelse) =>
      rattelse.projekt === null ||
      original.konteringar[rattelse.rad]?.projekt === rattelse.projekt
        ? []
        : [rattelse.projekt],
    ),
  );

  if (andring.datum !== undefined && andring.datum !== original.datum) {
    if (kontext.idag !== undefined) {
      kontrolleraInteFramtida(andring.datum, kontext.idag());
    }
    const paverkar = paverkarMomsdeklarationen(original.konteringar);

    kontrolleraBokforingsbart(gammaltAr, original.datum, paverkar);

    const nyttAr = await hittaAr(db, andring.datum);
    if (nyttAr.id !== gammaltAr.id) {
      throw new PeriodLastError(
        `${beteckning(original)} hör till räkenskapsåret ${gammaltAr.start}–` +
          `${gammaltAr.slut} och kan inte flyttas till ${andring.datum}. Ett ` +
          'verifikationsnummer gäller inom sitt år, så rätta med en annullering ' +
          'och ett nytt verifikat i rätt år i stället.',
      );
    }
    kontrolleraBokforingsbart(nyttAr, andring.datum, paverkar);
  }

  /*
   * One head, used for both. The rättelse recorded on the verifikat and the
   * log entry that carries it must say the same thing about when it happened,
   * and calling nu() twice is how they would come to differ by a millisecond.
   */
  const post = huvud(kontext);
  const rattat = ratta(original, {
    ...(andring.beskrivning === undefined ? {} : { beskrivning: andring.beskrivning }),
    ...(andring.datum === undefined ? {} : { datum: andring.datum }),
    ...(andring.projekt === undefined ? {} : { projekt: andring.projekt }),
    nar: post.tidpunkt,
    enhet: post.enhet,
  });

  await tillampa(db, {
    ...post,
    typ: 'verifikat.rattat',
    verifikatId: original.id,
    ...(andring.beskrivning === undefined ? {} : { beskrivning: rattat.beskrivning }),
    ...(andring.datum === undefined ? {} : { datum: rattat.datum }),
    ...(andring.projekt === undefined ? {} : { projekt: andring.projekt }),
  });
  return rattat;
}

/**
 * Writes the mirror that reverses a booked verifikat, in the same series.
 *
 * This is the first half of what the interface calls "Ändra"; the caller then
 * books whatever should have been there instead.
 */
export async function annulleraVerifikat(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  original: BokfortVerifikat,
  datum: Datum,
  beskrivning?: string,
): Promise<BokfortVerifikat> {
  const utkast = annullera(original, {
    id: nyttId(kontext),
    datum,
    ...(beskrivning === undefined ? {} : { beskrivning }),
  });
  return bokforUtkast(db, kontext, utkast, original.serie);
}

/** The highest number handed out in a series within a fiscal year. */
export async function hogstaNummer(
  db: KonteraDatabase,
  rakenskapsarId: Uuid,
  serie: Verifikatserie,
): Promise<number | undefined> {
  const sista = await db
    .table<VerifikatRad, Uuid>(VERIFIKAT_TABLE)
    .where('[rakenskapsarId+serie+nummer]')
    .between(
      [rakenskapsarId, serie, Number.MIN_SAFE_INTEGER],
      [rakenskapsarId, serie, Number.MAX_SAFE_INTEGER],
    )
    .last();
  return sista?.nummer;
}

/**
 * Which series this device hands out numbers in.
 *
 * One series per device is what lets two devices book offline without
 * agreeing on anything (UTVECKLINGSPLAN 3.1), so this is per installation
 * and never synchronised.
 */
export async function serieForEnhet(
  db: KonteraDatabase,
): Promise<Verifikatserie | undefined> {
  return db.getMeta<Verifikatserie>('verifikatserie');
}

export async function sattSerieForEnhet(
  db: KonteraDatabase,
  serie: Verifikatserie,
): Promise<void> {
  await db.setMeta('verifikatserie', serie);
}

async function hittaAr(db: KonteraDatabase, datum: Datum): Promise<Rakenskapsar> {
  const alla = await db.table<Rakenskapsar, Uuid>(RAKENSKAPSAR_TABLE).toArray();
  const ar = alla.find((kandidat) => omfattar(kandidat, datum));
  if (ar === undefined) {
    throw new Error(
      `Det finns inget räkenskapsår som omfattar ${datum}. Lägg upp året innan ` +
        'du bokför i det.',
    );
  }
  return ar;
}
