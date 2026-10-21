import { KVALITET, MAX_KANT } from '../platform/bild';
import type { Underlagstyp } from '../domain/underlag/underlag';

/** Re-encodes an image file to JPEG within the given bounds. */
export type Bildkodare = (
  sokvag: string,
  installning: { readonly maxKant: number; readonly kvalitet: number },
) => Promise<Uint8Array>;

export interface ForberettUnderlag {
  readonly data: Uint8Array;
  readonly mime: Underlagstyp;
  readonly filnamn: string;
}

const BILDANDELSER = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);

/**
 * Gets a file on disk into the shape the app stores.
 *
 * Images are re-encoded to the same bounds the phone's camera path uses
 * (src/platform/bild.ts): a photograph sent from the Claude app arrives at
 * full resolution, three to five megabytes, and the phone's storage has to
 * hold years of them. Re-encoding also flattens away HEIC, which is not a
 * format an archive can rely on, and the EXIF block with the location the
 * photograph was taken at, which is not bookkeeping.
 *
 * A PDF is kept byte for byte. It is an invoice as the supplier sent it, and
 * there is nothing to shrink.
 */
export async function forberedUnderlag(
  sokvag: string,
  namn: string,
  lasFil: (sokvag: string) => Promise<Uint8Array>,
  kodaBild: Bildkodare,
): Promise<ForberettUnderlag> {
  const andelse = sokvag.split('.').pop()?.toLowerCase() ?? '';

  if (andelse === 'pdf') {
    return {
      data: await lasFil(sokvag),
      mime: 'application/pdf',
      filnamn: `${namn}.pdf`,
    };
  }
  if (BILDANDELSER.has(andelse)) {
    return {
      data: await kodaBild(sokvag, { maxKant: MAX_KANT, kvalitet: KVALITET }),
      mime: 'image/jpeg',
      filnamn: `${namn}.jpg`,
    };
  }
  throw new TypeError(
    `${sokvag} är varken en bild eller en PDF. Kontera tar emot jpg, png, webp, ` +
      'heic och pdf.',
  );
}

/**
 * A filename for the stored copy, from the date and what was bought.
 *
 * The file the Claude app hands over is called something like
 * "7a57743d-photo.jpeg", which says nothing in an archive seven years on.
 * Lowercase ASCII, so the name survives every file system and zip tool.
 */
export function underlagsnamn(datum: string, beskrivning: string, index: number): string {
  const slug = beskrivning
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  const bas = slug.length === 0 ? datum : `${datum}-${slug}`;
  return index === 0 ? bas : `${bas}-${index + 1}`;
}
