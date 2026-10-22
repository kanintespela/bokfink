import {
  avyttra,
  type Anlaggningsavyttring,
  type Anlaggningstillgang,
} from '../anlaggning/anlaggningstillgang';
import {
  avyttraFastighet,
  bokforAvskrivningPaFastighet,
  type Fastighetsavyttring,
  type Fastighetstillgang,
} from '../anlaggning/fastighetstillgang';
import type { Ore } from '../belopp/ore';
import type { Djurlagerinventering } from '../lager/djurlager';
import type { Konto, Kontonummer } from '../konto/konto';
import type { Konteringsmall } from '../mall/konteringsmall';
import type { Ingaendebalans, Rakenskapsar } from '../rakenskapsar/rakenskapsar';
import type { Datum } from '../tid/datum';
import type { Uuid } from '../id/uuidv7';
import {
  farTasBort,
  frikoppla,
  koppla,
  OforanderligtUnderlagError,
  sattForfallodag,
  sattText,
  type Underlag,
} from '../underlag/underlag';
import {
  ratta,
  type BokfortVerifikat,
  type Verifikatutkast,
} from '../verifikat/verifikat';

/**
 * What every entry in the log carries, whatever it records.
 *
 * `id` is a UUIDv7, so the log has a total order that two devices arrive at
 * independently: sorting by id is sorting by the moment the entry was made,
 * with no sequence for them to agree on (docs/UTVECKLINGSPLAN.md, 3.1).
 *
 * `tidpunkt` is an instant rather than a Datum. It records when something was
 * entered, which is a technical fact about the machine, not a bookkeeping
 * date - those stay YYYY-MM-DD and live on the verifikat. Bokföringslagen
 * wants to know when a verifikation was sammanställd, and this is that field.
 */
interface Handelsehuvud {
  readonly id: Uuid;
  readonly enhet: string;
  /** ISO 8601 instant, e.g. 2026-09-05T08:17:05.123Z. */
  readonly tidpunkt: string;
}

/**
 * Everything that has ever happened to the books.
 *
 * The log is the authoritative record and every table is a view of it, which
 * is what makes the ledger auditable and what makes synchronisation a union
 * of two logs rather than a merge of two databases.
 */
export type Handelse =
  | (Handelsehuvud & { readonly typ: 'konto.skapat'; readonly konto: Konto })
  | (Handelsehuvud & { readonly typ: 'konto.andrat'; readonly konto: Konto })
  | (Handelsehuvud & {
      readonly typ: 'rakenskapsar.skapat';
      readonly rakenskapsar: Rakenskapsar;
    })
  | (Handelsehuvud & {
      readonly typ: 'rakenskapsar.momslast';
      readonly rakenskapsarId: Uuid;
      readonly tom: Datum;
    })
  | (Handelsehuvud & {
      readonly typ: 'rakenskapsar.avslutat';
      readonly rakenskapsarId: Uuid;
    })
  | (Handelsehuvud & {
      /**
       * A year removed before it held anything.
       *
       * The only removal the books allow. Two devices that both started out
       * empty used to create one calendar year each, and the one nobody
       * booked in is not räkenskapsinformation - it is a row that exists by
       * accident. A year with a verifikat or an opening balance in it is
       * refused (see kontrolleraBorttagbart), because that would be
       * bookkeeping and bokföringslagen 7 kap. 2 § keeps it for seven years.
       */
      readonly typ: 'rakenskapsar.borttaget';
      readonly rakenskapsarId: Uuid;
    })
  | (Handelsehuvud & {
      readonly typ: 'rakenskapsar.ingaendebalanser';
      readonly rakenskapsarId: Uuid;
      readonly balanser: readonly Ingaendebalans[];
    })
  | (Handelsehuvud & { readonly typ: 'utkast.sparat'; readonly utkast: Verifikatutkast })
  | (Handelsehuvud & { readonly typ: 'utkast.borttaget'; readonly utkastId: Uuid })
  | (Handelsehuvud & {
      readonly typ: 'verifikat.bokfort';
      readonly verifikat: BokfortVerifikat;
    })
  /*
   * A correction to what a booked verifikat says, never to what it does.
   *
   * The entry carries only the new values: när and vem are already on every
   * log entry as tidpunkt and enhet, which is exactly what bokföringslagen
   * 5 kap. 8 § asks a correction to record. Storing the whole corrected
   * verifikat instead would let a replay disagree with the original booking
   * about the konteringar, which is the one thing that must not be
   * correctable.
   */
  | (Handelsehuvud & {
      readonly typ: 'verifikat.rattat';
      readonly verifikatId: Uuid;
      readonly beskrivning?: string;
      readonly datum?: Datum;
    })
  | (Handelsehuvud & { readonly typ: 'mall.sparad'; readonly mall: Konteringsmall })
  | (Handelsehuvud & { readonly typ: 'mall.borttagen'; readonly mallId: Uuid })
  /*
   * The file itself is not in the entry. Only its metadata is, addressed by
   * the SHA-256 of bytes stored beside the log; see src/domain/underlag.
   */
  | (Handelsehuvud & { readonly typ: 'underlag.tillagt'; readonly underlag: Underlag })
  | (Handelsehuvud & {
      readonly typ: 'underlag.kopplat';
      readonly underlagId: Uuid;
      readonly verifikatId: Uuid;
    })
  | (Handelsehuvud & {
      readonly typ: 'underlag.frikopplat';
      readonly underlagId: Uuid;
      readonly verifikatId: Uuid;
    })
  | (Handelsehuvud & {
      readonly typ: 'underlag.avlast';
      readonly underlagId: Uuid;
      readonly text: string;
      /** How sure the reading was, 0-100, when the reader said. */
      readonly sakerhet?: number;
    })
  /*
   * Null removes the due date. It is a separate entry rather than part of
   * underlag.avlast because a person sets it, and when and on which device
   * that happened belongs in the log like any other decision.
   */
  | (Handelsehuvud & {
      readonly typ: 'underlag.forfallodag';
      readonly underlagId: Uuid;
      readonly forfallodag: Datum | null;
    })
  | (Handelsehuvud & {
      readonly typ: 'underlag.borttaget';
      readonly underlagId: Uuid;
    })
  | (Handelsehuvud & {
      readonly typ: 'anlaggning.registrerad';
      readonly tillgang: Anlaggningstillgang;
    })
  | (Handelsehuvud & {
      readonly typ: 'anlaggning.avyttrad';
      readonly tillgangId: Uuid;
      readonly avyttring: Anlaggningsavyttring;
    })
  | (Handelsehuvud & {
      readonly typ: 'fastighet.registrerad';
      readonly tillgang: Fastighetstillgang;
    })
  | (Handelsehuvud & {
      readonly typ: 'fastighet.avyttrad';
      readonly tillgangId: Uuid;
      readonly avyttring: Fastighetsavyttring;
    })
  | (Handelsehuvud & {
      readonly typ: 'fastighet.avskrivningBokford';
      readonly tillgangId: Uuid;
      readonly belopp: Ore;
    })
  | (Handelsehuvud & {
      readonly typ: 'djurlager.inventerat';
      readonly inventering: Djurlagerinventering;
    });

export type Handelsetyp = Handelse['typ'];

/** The books as they stand, rebuilt from the log. */
export interface Bokforingstillstand {
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly rakenskapsar: ReadonlyMap<Uuid, Rakenskapsar>;
  readonly utkast: ReadonlyMap<Uuid, Verifikatutkast>;
  readonly verifikat: ReadonlyMap<Uuid, BokfortVerifikat>;
  readonly mallar: ReadonlyMap<Uuid, Konteringsmall>;
  readonly underlag: ReadonlyMap<Uuid, Underlag>;
  readonly anlaggningar: ReadonlyMap<Uuid, Anlaggningstillgang>;
  readonly fastigheter: ReadonlyMap<Uuid, Fastighetstillgang>;
  readonly djurlagerinventeringar: ReadonlyMap<Uuid, Djurlagerinventering>;
}

/**
 * One row-level change a log entry asks for.
 *
 * The log's meaning is expressed once, here, so that folding it into memory
 * and writing it to the database cannot drift apart. Both walk the same list
 * of effects; only where they put them differs.
 */
export type Effekt =
  | { readonly tabell: 'konto'; readonly atgard: 'satt'; readonly post: Konto }
  | {
      readonly tabell: 'rakenskapsar';
      readonly atgard: 'satt';
      readonly post: Rakenskapsar;
    }
  | { readonly tabell: 'utkast'; readonly atgard: 'satt'; readonly post: Verifikatutkast }
  | { readonly tabell: 'rakenskapsar'; readonly atgard: 'ta-bort'; readonly id: Uuid }
  | { readonly tabell: 'utkast'; readonly atgard: 'ta-bort'; readonly id: Uuid }
  /*
   * Booking and correcting are told apart here, and stay apart all the way to
   * storage. A booking must be refused if the row already exists - that is
   * what catches a double-booked id - while a correction exists precisely to
   * replace the row it corrects. One atgard for both would make the write
   * path guess which it was looking at.
   */
  | {
      readonly tabell: 'verifikat';
      readonly atgard: 'satt' | 'ratta';
      readonly post: BokfortVerifikat;
    }
  | { readonly tabell: 'mall'; readonly atgard: 'satt'; readonly post: Konteringsmall }
  | { readonly tabell: 'mall'; readonly atgard: 'ta-bort'; readonly id: Uuid }
  | { readonly tabell: 'underlag'; readonly atgard: 'satt'; readonly post: Underlag }
  | { readonly tabell: 'underlag'; readonly atgard: 'ta-bort'; readonly id: Uuid }
  | {
      readonly tabell: 'anlaggning';
      readonly atgard: 'satt';
      readonly post: Anlaggningstillgang;
    }
  | {
      readonly tabell: 'fastighet';
      readonly atgard: 'satt';
      readonly post: Fastighetstillgang;
    }
  | {
      readonly tabell: 'djurlager';
      readonly atgard: 'satt';
      readonly post: Djurlagerinventering;
    };

/**
 * What {@link effekter} needs to know about the books before it can say what
 * an entry changes.
 *
 * Deliberately narrow. A caller reading from a database has to fetch these
 * before it can apply anything, and the smaller the question the cheaper that
 * is - one row rather than a whole ledger.
 */
export interface Tillstandsuppslag {
  rakenskapsar(id: Uuid): Rakenskapsar | undefined;
  verifikat(id: Uuid): BokfortVerifikat | undefined;
  underlag(id: Uuid): Underlag | undefined;
  anlaggning(id: Uuid): Anlaggningstillgang | undefined;
  fastighet(id: Uuid): Fastighetstillgang | undefined;
  djurlager(id: Uuid): Djurlagerinventering | undefined;
}

export class LoggkonfliktError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoggkonfliktError';
  }
}

/** Sorts by id, which for UUIDv7 is sorting by when the entry was made. */
export function iLoggordning(handelser: Iterable<Handelse>): Handelse[] {
  return [...handelser].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** What one log entry changes, given what the books already hold. */
export function effekter(
  handelse: Handelse,
  uppslag: Tillstandsuppslag,
): readonly Effekt[] {
  switch (handelse.typ) {
    case 'konto.skapat':
    case 'konto.andrat':
      return [{ tabell: 'konto', atgard: 'satt', post: handelse.konto }];

    case 'rakenskapsar.skapat':
      return [{ tabell: 'rakenskapsar', atgard: 'satt', post: handelse.rakenskapsar }];

    case 'rakenskapsar.borttaget':
      return [{ tabell: 'rakenskapsar', atgard: 'ta-bort', id: handelse.rakenskapsarId }];

    case 'rakenskapsar.momslast': {
      const ar = kravAr(uppslag, handelse.rakenskapsarId, 'momslåsa');
      return [
        {
          tabell: 'rakenskapsar',
          atgard: 'satt',
          post: { ...ar, momslastTom: handelse.tom },
        },
      ];
    }

    case 'rakenskapsar.avslutat': {
      const ar = kravAr(uppslag, handelse.rakenskapsarId, 'avsluta');
      return [
        { tabell: 'rakenskapsar', atgard: 'satt', post: { ...ar, avslutat: true } },
      ];
    }

    case 'rakenskapsar.ingaendebalanser': {
      /*
       * Set rather than merged. A year's opening balances are one statement
       * about where it started, and half of one is worse than none.
       */
      const ar = kravAr(uppslag, handelse.rakenskapsarId, 'sätta ingående balanser på');
      return [
        {
          tabell: 'rakenskapsar',
          atgard: 'satt',
          post: { ...ar, ingaendeBalanser: handelse.balanser },
        },
      ];
    }

    case 'utkast.sparat':
      return [{ tabell: 'utkast', atgard: 'satt', post: handelse.utkast }];

    case 'utkast.borttaget':
      return [{ tabell: 'utkast', atgard: 'ta-bort', id: handelse.utkastId }];

    case 'mall.sparad':
      return [{ tabell: 'mall', atgard: 'satt', post: handelse.mall }];

    case 'mall.borttagen':
      return [{ tabell: 'mall', atgard: 'ta-bort', id: handelse.mallId }];

    case 'underlag.tillagt': {
      /*
       * Adding the same file twice is the normal case rather than an error:
       * the same receipt can reach two devices, and both will hash it to the
       * same address. The row that is already there wins, so a second entry
       * cannot undo links the first one has since collected.
       */
      const befintligt = uppslag.underlag(handelse.underlag.id);
      if (befintligt !== undefined) {
        return [];
      }
      return [{ tabell: 'underlag', atgard: 'satt', post: handelse.underlag }];
    }

    case 'underlag.kopplat': {
      const post = kravUnderlag(uppslag, handelse.underlagId, 'koppla');
      return [
        { tabell: 'underlag', atgard: 'satt', post: koppla(post, handelse.verifikatId) },
      ];
    }

    case 'underlag.frikopplat': {
      const post = kravUnderlag(uppslag, handelse.underlagId, 'frikoppla');
      return [
        {
          tabell: 'underlag',
          atgard: 'satt',
          post: frikoppla(post, handelse.verifikatId),
        },
      ];
    }

    case 'underlag.avlast': {
      const post = kravUnderlag(uppslag, handelse.underlagId, 'lägga tolkad text på');
      return [
        {
          tabell: 'underlag',
          atgard: 'satt',
          post: sattText(post, handelse.text, handelse.sakerhet),
        },
      ];
    }

    case 'underlag.forfallodag': {
      const post = kravUnderlag(uppslag, handelse.underlagId, 'sätta förfallodag på');
      return [
        {
          tabell: 'underlag',
          atgard: 'satt',
          post: sattForfallodag(post, handelse.forfallodag ?? undefined),
        },
      ];
    }

    case 'underlag.borttaget': {
      const post = uppslag.underlag(handelse.underlagId);
      if (post === undefined) {
        // Already gone. A sync can deliver the same removal twice, and the
        // second one has nothing left to do rather than something to complain
        // about.
        return [];
      }
      if (!farTasBort(post)) {
        // The evidence for a booked verifikat is not something a log entry
        // gets to remove, whoever wrote it.
        throw new OforanderligtUnderlagError(post.id);
      }
      return [{ tabell: 'underlag', atgard: 'ta-bort', id: post.id }];
    }

    case 'anlaggning.registrerad': {
      if (uppslag.anlaggning(handelse.tillgang.id) !== undefined) {
        // Same reasoning as verifikat.bokfort: two entries registering the
        // same id would let a second one silently overwrite the first,
        // including an avyttring the first one had already recorded.
        throw new LoggkonfliktError(
          `Anläggningstillgång ${handelse.tillgang.id} registreras två gånger i ` +
            'händelseloggen.',
        );
      }
      return [{ tabell: 'anlaggning', atgard: 'satt', post: handelse.tillgang }];
    }

    case 'anlaggning.avyttrad': {
      const post = kravAnlaggning(uppslag, handelse.tillgangId, 'avyttra');
      return [
        { tabell: 'anlaggning', atgard: 'satt', post: avyttra(post, handelse.avyttring) },
      ];
    }

    case 'fastighet.registrerad': {
      if (uppslag.fastighet(handelse.tillgang.id) !== undefined) {
        throw new LoggkonfliktError(
          `Fastighetstillgång ${handelse.tillgang.id} registreras två gånger i ` +
            'händelseloggen.',
        );
      }
      return [{ tabell: 'fastighet', atgard: 'satt', post: handelse.tillgang }];
    }

    case 'fastighet.avyttrad': {
      const post = kravFastighet(uppslag, handelse.tillgangId, 'avyttra');
      return [
        {
          tabell: 'fastighet',
          atgard: 'satt',
          post: avyttraFastighet(post, handelse.avyttring),
        },
      ];
    }

    case 'fastighet.avskrivningBokford': {
      const post = kravFastighet(uppslag, handelse.tillgangId, 'skriva av');
      return [
        {
          tabell: 'fastighet',
          atgard: 'satt',
          post: bokforAvskrivningPaFastighet(post, handelse.belopp),
        },
      ];
    }

    case 'djurlager.inventerat': {
      if (uppslag.djurlager(handelse.inventering.id) !== undefined) {
        throw new LoggkonfliktError(
          `Djurlagerinventering ${handelse.inventering.id} registreras två gånger i ` +
            'händelseloggen.',
        );
      }
      return [{ tabell: 'djurlager', atgard: 'satt', post: handelse.inventering }];
    }

    case 'verifikat.bokfort': {
      const id = handelse.verifikat.id;
      if (uppslag.verifikat(id) !== undefined) {
        /*
         * Hard rule 5 seen from the log's side. Two entries booking the same
         * verifikat means the log is corrupt or two devices reused an id, and
         * quietly keeping one would rewrite bookkeeping meant to be permanent.
         */
        throw new LoggkonfliktError(
          `Verifikat ${id} bokförs två gånger i händelseloggen. Ett bokfört ` +
            'verifikat kan inte skrivas om.',
        );
      }
      return [
        { tabell: 'verifikat', atgard: 'satt', post: handelse.verifikat },
        // Booking consumes the draft it came from.
        { tabell: 'utkast', atgard: 'ta-bort', id },
      ];
    }

    case 'verifikat.rattat': {
      const original = uppslag.verifikat(handelse.verifikatId);
      if (original === undefined) {
        throw new LoggkonfliktError(
          `Verifikat ${handelse.verifikatId} rättas i händelseloggen utan att ha ` +
            'bokförts. Loggen är ofullständig.',
        );
      }
      return [
        {
          tabell: 'verifikat',
          atgard: 'ratta',
          post: ratta(original, {
            ...(handelse.beskrivning === undefined
              ? {}
              : { beskrivning: handelse.beskrivning }),
            ...(handelse.datum === undefined ? {} : { datum: handelse.datum }),
            // BFL 5 kap. 8 § wants when and who; the log entry is both.
            nar: handelse.tidpunkt,
            enhet: handelse.enhet,
          }),
        },
      ];
    }
  }
}

/**
 * Folds the log into the state it describes.
 *
 * Entries are sorted by id first, so the result does not depend on the order
 * they arrived in. Two devices that exchange logs therefore reach the same
 * books without negotiating anything, and replaying a log always gives what
 * it gave last time.
 *
 * Repeats are ignored: the same entry id may legitimately arrive twice from a
 * sync, and applying it twice must not change the outcome.
 */
export function bygg(handelser: Iterable<Handelse>): Bokforingstillstand {
  const konton = new Map<Kontonummer, Konto>();
  const rakenskapsar = new Map<Uuid, Rakenskapsar>();
  const utkast = new Map<Uuid, Verifikatutkast>();
  const verifikat = new Map<Uuid, BokfortVerifikat>();
  const mallar = new Map<Uuid, Konteringsmall>();
  const underlag = new Map<Uuid, Underlag>();
  const anlaggningar = new Map<Uuid, Anlaggningstillgang>();
  const fastigheter = new Map<Uuid, Fastighetstillgang>();
  const djurlagerinventeringar = new Map<Uuid, Djurlagerinventering>();
  const sedda = new Set<Uuid>();

  const uppslag: Tillstandsuppslag = {
    rakenskapsar: (id) => rakenskapsar.get(id),
    verifikat: (id) => verifikat.get(id),
    underlag: (id) => underlag.get(id),
    anlaggning: (id) => anlaggningar.get(id),
    fastighet: (id) => fastigheter.get(id),
    djurlager: (id) => djurlagerinventeringar.get(id),
  };

  for (const handelse of iLoggordning(handelser)) {
    if (sedda.has(handelse.id)) {
      continue;
    }
    sedda.add(handelse.id);

    for (const effekt of effekter(handelse, uppslag)) {
      switch (effekt.tabell) {
        case 'konto':
          konton.set(effekt.post.nummer, effekt.post);
          break;
        case 'rakenskapsar':
          if (effekt.atgard === 'satt') {
            rakenskapsar.set(effekt.post.id, effekt.post);
          } else {
            rakenskapsar.delete(effekt.id);
          }
          break;
        case 'utkast':
          if (effekt.atgard === 'satt') {
            utkast.set(effekt.post.id, effekt.post);
          } else {
            utkast.delete(effekt.id);
          }
          break;
        case 'verifikat':
          verifikat.set(effekt.post.id, effekt.post);
          break;
        case 'mall':
          if (effekt.atgard === 'satt') {
            mallar.set(effekt.post.id, effekt.post);
          } else {
            mallar.delete(effekt.id);
          }
          break;
        case 'underlag':
          if (effekt.atgard === 'satt') {
            underlag.set(effekt.post.id, effekt.post);
          } else {
            underlag.delete(effekt.id);
          }
          break;
        case 'anlaggning':
          anlaggningar.set(effekt.post.id, effekt.post);
          break;
        case 'fastighet':
          fastigheter.set(effekt.post.id, effekt.post);
          break;
        case 'djurlager':
          djurlagerinventeringar.set(effekt.post.id, effekt.post);
          break;
      }
    }
  }

  return {
    konton,
    rakenskapsar,
    utkast,
    verifikat,
    mallar,
    underlag,
    anlaggningar,
    fastigheter,
    djurlagerinventeringar,
  };
}

function kravUnderlag(uppslag: Tillstandsuppslag, id: Uuid, vad: string): Underlag {
  const post = uppslag.underlag(id);
  if (post === undefined) {
    // Hard rule 11 again: an entry about a file the log never added is a
    // broken log, and pretending otherwise would lose the link silently.
    throw new LoggkonfliktError(
      `Händelseloggen vill ${vad} underlag ${id}, som inte finns i loggen.`,
    );
  }
  return post;
}

function kravAnlaggning(
  uppslag: Tillstandsuppslag,
  id: Uuid,
  vad: string,
): Anlaggningstillgang {
  const post = uppslag.anlaggning(id);
  if (post === undefined) {
    throw new LoggkonfliktError(
      `Händelseloggen vill ${vad} anläggningstillgång ${id}, som inte finns i loggen.`,
    );
  }
  return post;
}

function kravFastighet(
  uppslag: Tillstandsuppslag,
  id: Uuid,
  vad: string,
): Fastighetstillgang {
  const post = uppslag.fastighet(id);
  if (post === undefined) {
    throw new LoggkonfliktError(
      `Händelseloggen vill ${vad} fastighetstillgång ${id}, som inte finns i loggen.`,
    );
  }
  return post;
}

function kravAr(uppslag: Tillstandsuppslag, id: Uuid, vad: string): Rakenskapsar {
  const ar = uppslag.rakenskapsar(id);
  if (ar === undefined) {
    // Hard rule 11: a log that refers to something that does not exist is
    // broken, and has to say so rather than skip the entry.
    throw new LoggkonfliktError(
      `Händelseloggen vill ${vad} räkenskapsår ${id}, som inte finns i loggen.`,
    );
  }
  return ar;
}
