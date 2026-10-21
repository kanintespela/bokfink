import type { Uuid } from '../id/uuidv7';
import type { Datum } from '../tid/datum';

/**
 * The SHA-256 of a file's bytes, as 64 lowercase hex characters.
 *
 * Branded so a hash cannot be confused with any other string. It is what
 * makes a file identifiable: two devices that photograph nothing twice still
 * end up storing one copy of a receipt that reached both, and an archive can
 * be checked against it years later. Bokföringslagen (1999:1078) 7 kap. 1 §
 * wants räkenskapsinformation kept in ordnat skick och på betryggande sätt,
 * and a checksum is how "betryggande" is demonstrated for a digital copy.
 */
export type Sha256 = string & { readonly __brand: 'Sha256' };

const HEX64 = /^[0-9a-f]{64}$/;

export function sha256(hex: string): Sha256 {
  if (!HEX64.test(hex)) {
    throw new TypeError(
      `"${hex}" är ingen SHA-256-summa. Den ska vara 64 tecken 0-9 och a-f, ` +
        'med små bokstäver.',
    );
  }
  return hex as Sha256;
}

/**
 * The file types an underlag may have.
 *
 * Deliberately short. Everything here can still be opened without Kontera in
 * seven years, which is the requirement an archive format has to meet; a
 * format that needs a particular app to read is not an archive. HEIC, which
 * an iPhone would rather produce, is missing on purpose - the camera layer
 * converts to JPEG or WebP before anything is stored.
 */
export const UNDERLAGSTYPER = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export type Underlagstyp = (typeof UNDERLAGSTYPER)[number];

export function arUnderlagstyp(mime: string): mime is Underlagstyp {
  return (UNDERLAGSTYPER as readonly string[]).includes(mime);
}

/**
 * The largest file that may be stored as an underlag.
 *
 * IndexedDB gives a PWA on the order of a gigabyte, which has to hold years
 * of receipts, so an accidental 40-megapixel original is refused rather than
 * quietly eating a twentieth of the budget. Photographs are compressed well
 * below this before they get here; the limit is the backstop, not the target.
 */
export const MAX_UNDERLAG_BYTES = 10 * 1024 * 1024;

/**
 * A receipt, an invoice or another document that proves a business event.
 *
 * The bytes are not here. An underlag row is metadata and lives in the event
 * log like everything else; the file itself is stored beside the log, keyed
 * by its hash (see src/data/schema.ts). That split is deliberate: a log that
 * carried megabytes of images could not be replayed, synchronised or exported
 * as the small append-only record it is meant to be.
 */
export interface Underlag {
  readonly id: Uuid;
  readonly sha256: Sha256;
  readonly mime: Underlagstyp;
  /** The file's size in bytes. */
  readonly storlek: number;
  /** What to call the file when it is shared or archived. */
  readonly filnamn: string;
  /** ISO 8601 instant. When the file was added, not when the receipt is from. */
  readonly tillagd: string;
  /**
   * The verifikat this is evidence for.
   *
   * Many-to-many, because both directions happen: one card receipt can cover
   * two bookings, and one booking can need both an invoice and a proof of
   * payment. The link lives here rather than on the verifikat because a
   * booked verifikat is immutable (hard rule 5) and evidence can turn up
   * after the fact - which is the normal case when a receipt is photographed
   * the week after the purchase.
   *
   * A link can also point at a draft. Booking keeps the draft's id, so the
   * receipt becomes the booked verifikat's evidence without a further step.
   */
  readonly verifikat: readonly Uuid[];
  /** What OCR read out of it, once it has been read. */
  readonly text?: string;
  /**
   * How sure the reading was, 0-100.
   *
   * Kept because it decides whether the text is worth anything: a photograph
   * taken in a dark car reads at 43 and produces confident nonsense, and the
   * figure has to travel with the text so a receipt opened a second time is
   * judged the same way as the first.
   */
  readonly sakerhet?: number;
  /**
   * The last day an invoice waiting here should be paid.
   *
   * Under kontantmetoden a leverantörsfaktura is not booked until it is
   * paid, so until then this underlag is the only record of it, and the
   * only place its due date can live. Set by a person, never by OCR alone
   * (hard rule 10): a misread due date that nobody looked at is worse than
   * none, because it would be trusted.
   */
  readonly forfallodag?: Datum;
}

export interface Underlagsuppgifter {
  readonly id: Uuid;
  readonly sha256: Sha256;
  readonly mime: string;
  readonly storlek: number;
  readonly filnamn: string;
  readonly tillagd: string;
}

/** Builds an underlag, refusing anything that could not be archived. */
export function skapaUnderlag(uppgifter: Underlagsuppgifter): Underlag {
  if (!arUnderlagstyp(uppgifter.mime)) {
    throw new TypeError(
      `Kontera kan inte lagra ett underlag av typen "${uppgifter.mime}". ` +
        `Tillåtna typer är ${UNDERLAGSTYPER.join(', ')}.`,
    );
  }
  if (!Number.isInteger(uppgifter.storlek) || uppgifter.storlek <= 0) {
    throw new RangeError(
      `Ett underlag måste ha en storlek i hela byte, fick ${uppgifter.storlek}.`,
    );
  }
  if (uppgifter.storlek > MAX_UNDERLAG_BYTES) {
    throw new RangeError(
      `Underlaget är ${Math.round(uppgifter.storlek / 1024 / 1024)} MB och därmed ` +
        `större än gränsen på ${MAX_UNDERLAG_BYTES / 1024 / 1024} MB.`,
    );
  }
  if (uppgifter.filnamn.trim().length === 0) {
    throw new TypeError('Ett underlag måste ha ett filnamn.');
  }

  return Object.freeze({
    id: uppgifter.id,
    sha256: uppgifter.sha256,
    mime: uppgifter.mime,
    storlek: uppgifter.storlek,
    filnamn: uppgifter.filnamn.trim(),
    tillagd: uppgifter.tillagd,
    verifikat: Object.freeze([]),
  });
}

/**
 * Links an underlag to a verifikat.
 *
 * Idempotent and order-independent: the same link applied twice, or applied
 * on two devices, has to give the same row. Two logs merged in either order
 * must agree (docs/UTVECKLINGSPLAN.md, 3.1), so the list is kept sorted
 * rather than in the order the links happened to arrive.
 */
export function koppla(underlag: Underlag, verifikatId: Uuid): Underlag {
  if (underlag.verifikat.includes(verifikatId)) {
    return underlag;
  }
  return Object.freeze({
    ...underlag,
    verifikat: Object.freeze([...underlag.verifikat, verifikatId].sort()),
  });
}

/**
 * Removes a link.
 *
 * The underlag itself stays. A photograph attached to the wrong verifikat is
 * a mistake in the link, not in the evidence, and räkenskapsinformation that
 * has been stored is kept (bokföringslagen 7 kap. 2 §) rather than deleted
 * because it turned out to belong somewhere else.
 */
export function frikoppla(underlag: Underlag, verifikatId: Uuid): Underlag {
  if (!underlag.verifikat.includes(verifikatId)) {
    return underlag;
  }
  return Object.freeze({
    ...underlag,
    verifikat: Object.freeze(underlag.verifikat.filter((id) => id !== verifikatId)),
  });
}

/** Records what OCR read, so the text can be searched without re-reading. */
export function sattText(underlag: Underlag, text: string, sakerhet?: number): Underlag {
  return Object.freeze({
    ...underlag,
    text,
    ...(sakerhet === undefined ? {} : { sakerhet }),
  });
}

/** Sets or, with undefined, removes the due date of an invoice. */
export function sattForfallodag(
  underlag: Underlag,
  forfallodag: Datum | undefined,
): Underlag {
  const kopia: { -readonly [K in keyof Underlag]: Underlag[K] } = { ...underlag };
  if (forfallodag === undefined) {
    delete kopia.forfallodag;
  } else {
    kopia.forfallodag = forfallodag;
  }
  return Object.freeze(kopia);
}

/** An underlag nobody has attached to a verifikat yet. */
export function arOkopplat(underlag: Underlag): boolean {
  return underlag.verifikat.length === 0;
}

export class OforanderligtUnderlagError extends Error {
  constructor(readonly underlagId: Uuid) {
    super(
      'Underlaget hör till ett bokfört verifikat och kan inte tas bort. ' +
        'Räkenskapsinformation ska bevaras i sju år (bokföringslagen 7 kap. 2 §).',
    );
    this.name = 'OforanderligtUnderlagError';
  }
}

/**
 * Whether a stored file may be thrown away.
 *
 * The line runs between a photograph and räkenskapsinformation, and it is the
 * link that decides which one a picture is. Attached to a verifikat, it is
 * the evidence for a booked affärshändelse and bokföringslagen 7 kap. 2 §
 * wants it kept for seven years. Attached to nothing, it is a blurred picture
 * of a table, and refusing to delete it would be superstition rather than
 * bookkeeping.
 *
 * Detaching first is not a way around this: a booked verifikat is immutable
 * and nothing offers to unlink evidence from one.
 */
export function farTasBort(underlag: Underlag): boolean {
  return arOkopplat(underlag);
}
