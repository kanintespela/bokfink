import type { Uuid } from '../id/uuidv7';
import type { Datum } from '../tid/datum';
import { tolkaKvitto } from '../underlag/kvittotolkning';
import type { Underlag } from '../underlag/underlag';
import type { BokfortVerifikat } from '../verifikat/verifikat';

/**
 * Remembering how a supplier was booked last time.
 *
 * The strongest hint a receipt carries is not a word on it but who it is
 * from: a farm shop sells feed, and the last receipt from it was booked as
 * feed. The receipt assistant has always worked this way (beslut N); this is
 * the same idea on the device, from the device's own log. Nothing is sent
 * anywhere and nothing is learned beyond what was booked.
 *
 * Matched on the organisationsnummer when the receipt has one, since OCR
 * mangles names ("Exenpel Lantbruk") far more often than a printed number, and
 * on the name otherwise.
 */
export interface TidigareKop {
  readonly orgnr?: string;
  readonly leverantor?: string;
  /** The template, that is the leaf, the verifikat was booked with. */
  readonly mall: Uuid;
  readonly datum: Datum;
}

export interface Minnesforslag {
  readonly mall: Uuid;
  /** The earlier purchase it follows, so the interface can say which. */
  readonly forebild: TidigareKop;
}

/** Shorter names match by accident, as on the templates. */
const MINSTA_NAMN = 4;

export function foreslaFranTidigare(
  kvitto: { readonly orgnr?: string; readonly leverantor?: string },
  tidigare: readonly TidigareKop[],
): Minnesforslag | undefined {
  const orgnr = kvitto.orgnr === undefined ? undefined : siffror(kvitto.orgnr);
  const namn =
    kvitto.leverantor === undefined ? undefined : normalisera(kvitto.leverantor);

  const traffar = tidigare.filter((kop) => {
    if (orgnr !== undefined && kop.orgnr !== undefined) {
      return siffror(kop.orgnr) === orgnr;
    }
    return (
      namn !== undefined &&
      namn.length >= MINSTA_NAMN &&
      kop.leverantor !== undefined &&
      normalisera(kop.leverantor) === namn
    );
  });

  // The latest wins: how a supplier is booked can change, and the last time
  // is the best guess at this time.
  const senaste = [...traffar].sort((a, b) => b.datum.localeCompare(a.datum))[0];
  return senaste === undefined ? undefined : { mall: senaste.mall, forebild: senaste };
}

function siffror(text: string): string {
  return text.replace(/\D/g, '');
}

function normalisera(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every booked purchase whose receipt was read, as the memory above needs it.
 *
 * The supplier is read out of the stored text again rather than kept from
 * the time of booking: the reading improves now and then, and an old
 * receipt read by today's rules is the one comparable with today's receipt.
 */
export function tidigareKop(
  underlag: Iterable<Underlag>,
  verifikat: ReadonlyMap<Uuid, BokfortVerifikat>,
  idag: Datum,
): TidigareKop[] {
  const kop: TidigareKop[] = [];
  for (const post of underlag) {
    if (post.text === undefined) {
      continue;
    }
    const lasning = tolkaKvitto(post.text, idag);
    for (const id of post.verifikat) {
      const bokford = verifikat.get(id);
      if (bokford?.mall === undefined) {
        continue;
      }
      kop.push({
        ...(lasning.orgnr === undefined ? {} : { orgnr: lasning.orgnr }),
        ...(lasning.leverantor === undefined ? {} : { leverantor: lasning.leverantor }),
        mall: bokford.mall,
        datum: bokford.datum,
      });
    }
  }
  return kop;
}
