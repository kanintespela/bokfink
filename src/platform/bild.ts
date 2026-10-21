import {
  arUnderlagstyp,
  MAX_UNDERLAG_BYTES,
  type Underlagstyp,
} from '../domain/underlag/underlag';
import { arJpeg, jpegOrientering, utanMetadata } from './jpeg';

/**
 * Getting a photographed or picked file into something storable.
 *
 * A phone camera produces four to twelve megabytes per picture. Years of
 * those would fill the storage a PWA gets several times over, so every image
 * is re-encoded before it is stored - and re-encoded here, in the platform
 * layer, because it needs a canvas.
 */

/**
 * The longest edge a stored receipt keeps.
 *
 * A4 scanned at 200 dpi is 1654 x 2339 pixels, which is the resolution
 * archives and OCR engines are usually happy with. 2000 keeps a receipt above
 * that on its long edge while cutting a 12-megapixel photograph to a few
 * hundred kilobytes. Small print on a folded receipt is the case this has to
 * survive, so it is deliberately not lower.
 */
export const MAX_KANT = 2000;

/**
 * How far the picture is turned before anything else happens.
 *
 * A receipt is long and thin, so it is photographed lying across the frame as
 * often as standing in it - and OCR reads horizontal text only. Measured
 * rather than assumed: the same five lines read cleanly upright and came back
 * as "= I Oo Zz / Oo Oo bb Db H" turned a quarter turn.
 *
 * Turning it is worth doing for its own sake too. The picture is what an
 * archive holds for seven years, and one that has to be tilted to read is
 * worse than one that does not.
 */
export type Vridning = 0 | 90 | 180 | 270;

/**
 * JPEG quality. High enough that the compression does not eat the thin type
 * on a thermal receipt, low enough that a page is a couple of hundred
 * kilobytes rather than a couple of megabytes.
 */
export const KVALITET = 0.8;

/**
 * A crop as fractions of the picture, 0 to 1.
 *
 * Fractions rather than pixels, because the only place the picture's real
 * size is known is inside this module, after decoding. A view that let the
 * user drag a frame over a scaled-down image would otherwise have to guess
 * at it.
 */
export interface Andelsutsnitt {
  readonly x: number;
  readonly y: number;
  readonly bredd: number;
  readonly hojd: number;
}

/** A rectangle in the source image's own pixels. */
export interface Utsnitt {
  readonly x: number;
  readonly y: number;
  readonly bredd: number;
  readonly hojd: number;
}

/**
 * The smallest crop that is still a receipt rather than a slip of the finger.
 *
 * A crop this small on a phone is almost always a tap that turned into a
 * drag, and a picture of nothing is worse than an uncropped one.
 */
export const MINSTA_UTSNITT = 32;

export interface Forberedelse {
  readonly vridning?: Vridning;
  /** The crop, in fractions of the picture as it looks after turning. */
  readonly utsnitt?: Andelsutsnitt;
}

export interface Forberedd {
  readonly filnamn: string;
  readonly mime: Underlagstyp;
  readonly data: Uint8Array;
}

/**
 * What to scale an image to.
 *
 * Only ever down: enlarging a small picture would cost storage and add no
 * detail. The aspect ratio is kept, and both sides stay at least one pixel so
 * a degenerate image cannot produce a canvas of nothing.
 */
export function malmatt(
  bredd: number,
  hojd: number,
  maxKant = MAX_KANT,
): { bredd: number; hojd: number } {
  const langsta = Math.max(bredd, hojd);
  if (langsta <= maxKant) {
    return { bredd, hojd };
  }
  const skala = maxKant / langsta;
  return {
    bredd: Math.max(1, Math.round(bredd * skala)),
    hojd: Math.max(1, Math.round(hojd * skala)),
  };
}

/** The size a picture has once it is turned. */
export function vridnaMatt(
  bredd: number,
  hojd: number,
  vridning: Vridning,
): { bredd: number; hojd: number } {
  return vridning === 90 || vridning === 270
    ? { bredd: hojd, hojd: bredd }
    : { bredd, hojd };
}

/**
 * Trims a crop to something that is inside the picture and worth keeping.
 *
 * Pointer coordinates arrive as floats and can wander outside the image
 * while a finger is still down, so the rectangle is rounded to whole pixels
 * and clamped. A crop smaller than {@link MINSTA_UTSNITT} on either side is
 * refused by returning the whole picture: it was a mis-drag, not a choice.
 */
export function begransaUtsnitt(utsnitt: Utsnitt, bredd: number, hojd: number): Utsnitt {
  const x1 = Math.max(0, Math.min(bredd, Math.round(utsnitt.x)));
  const y1 = Math.max(0, Math.min(hojd, Math.round(utsnitt.y)));
  const x2 = Math.max(0, Math.min(bredd, Math.round(utsnitt.x + utsnitt.bredd)));
  const y2 = Math.max(0, Math.min(hojd, Math.round(utsnitt.y + utsnitt.hojd)));

  const vanster = Math.min(x1, x2);
  const topp = Math.min(y1, y2);
  const nyBredd = Math.abs(x2 - x1);
  const nyHojd = Math.abs(y2 - y1);

  if (nyBredd < MINSTA_UTSNITT || nyHojd < MINSTA_UTSNITT) {
    return { x: 0, y: 0, bredd, hojd };
  }
  return { x: vanster, y: topp, bredd: nyBredd, hojd: nyHojd };
}

/** The name the file is stored under once it has been re-encoded as JPEG. */
export function jpegnamn(filnamn: string): string {
  const utanSokvag = filnamn.split(/[\\/]/).pop() ?? filnamn;
  const stam = utanSokvag.replace(/\.[^.]+$/, '');
  return `${stam.length > 0 ? stam : 'underlag'}.jpg`;
}

/**
 * Reads a picked file and returns what should be stored.
 *
 * PDFs pass through untouched - re-encoding one would lose its text layer,
 * which is the thing that makes a supplier invoice searchable. Everything
 * else is decoded, scaled and written back out as JPEG.
 *
 * JPEG rather than WebP, even though WebP is a third smaller. Canvas encoding
 * to WebP is not something every Safari version does, and a receipt silently
 * saved as a PNG-sized file - or not saved at all - is a worse trade than the
 * bytes. This is also the conversion that keeps HEIC out of storage: what
 * comes back is a format anything can open in seven years.
 */
export async function forberedUnderlag(
  fil: File,
  forberedelse: Forberedelse = {},
): Promise<Forberedd> {
  if (fil.type === 'application/pdf') {
    const data = new Uint8Array(await fil.arrayBuffer());
    kontrolleraStorlek(data.byteLength, fil.name);
    return { filnamn: fil.name, mime: 'application/pdf', data };
  }

  if (!fil.type.startsWith('image/')) {
    throw new TypeError(
      `Kontera kan bara ta emot bilder och PDF-filer som underlag. "${fil.name}" ` +
        `är av typen ${fil.type.length > 0 ? fil.type : 'okänd typ'}.`,
    );
  }

  const bild = await avkoda(fil);
  try {
    /*
     * Nothing to do, so nothing is done.
     *
     * A picture that is not being turned or cropped and already fits inside
     * MAX_KANT gains nothing from a trip through the canvas, and loses a
     * generation of JPEG to it. Measured on a real export from another
     * service: 116 780 bytes in, 130 378 bytes out, and softer - larger and
     * worse, because the file was already compressed harder than KVALITET.
     *
     * Judged by the bytes rather than by fil.type, which is what the browser
     * guessed from the name: the same export had a JPEG called .png in it.
     *
     * Only when it is already upright. A photograph that states any other
     * orientation is stored turned and looks right only where the tag is
     * honoured, so it goes the long way round and has the rotation drawn into
     * its pixels instead. The metadata still goes either way - a phone writes
     * the coordinates of the shop into the receipt it photographs, and an
     * underlag is a thing that gets exported and mailed on.
     */
    const orort =
      (forberedelse.vridning ?? 0) === 0 &&
      forberedelse.utsnitt === undefined &&
      Math.max(bild.width, bild.height) <= MAX_KANT;
    if (orort) {
      const original = new Uint8Array(await fil.arrayBuffer());
      const orientering = jpegOrientering(original);
      if (arJpeg(original) && (orientering === undefined || orientering === 1)) {
        const rensad = utanMetadata(original);
        kontrolleraStorlek(rensad.byteLength, fil.name);
        return { filnamn: jpegnamn(fil.name), mime: 'image/jpeg', data: rensad };
      }
    }

    const duk = maladuk(bild, forberedelse);
    const data = new Uint8Array(await tillJpeg(duk));
    kontrolleraStorlek(data.byteLength, fil.name);
    return { filnamn: jpegnamn(fil.name), mime: 'image/jpeg', data };
  } finally {
    bild.close();
  }
}

/**
 * The picture turned, cropped and scaled, in that order.
 *
 * The order is the whole point. Turning first means the crop is expressed in
 * the picture as the person saw it when they dragged the corners, and
 * cropping before scaling means the 2000 pixels go to the receipt rather than
 * to the table around it.
 */
function maladuk(bild: ImageBitmap, forberedelse: Forberedelse): HTMLCanvasElement {
  const vridning = forberedelse.vridning ?? 0;
  const vriden = vridnaMatt(bild.width, bild.height, vridning);

  const kalla =
    forberedelse.utsnitt === undefined
      ? { x: 0, y: 0, bredd: vriden.bredd, hojd: vriden.hojd }
      : begransaUtsnitt(
          {
            x: forberedelse.utsnitt.x * vriden.bredd,
            y: forberedelse.utsnitt.y * vriden.hojd,
            bredd: forberedelse.utsnitt.bredd * vriden.bredd,
            hojd: forberedelse.utsnitt.hojd * vriden.hojd,
          },
          vriden.bredd,
          vriden.hojd,
        );

  const { bredd, hojd } = malmatt(kalla.bredd, kalla.hojd);
  const duk = document.createElement('canvas');
  duk.width = bredd;
  duk.height = hojd;

  const ritare = duk.getContext('2d');
  if (ritare === null) {
    throw new Error(
      'Webbläsaren kunde inte rita om bilden, så kvittot kunde inte sparas.',
    );
  }

  /*
   * Drawn through a transform rather than in two passes: the crop is a window
   * onto the turned picture, so the canvas is moved and turned under it and
   * the whole image is drawn once, at the size it should end up.
   */
  const skala = bredd / kalla.bredd;
  ritare.scale(skala, skala);
  ritare.translate(-kalla.x, -kalla.y);
  vridUnderlag(ritare, bild, vridning);
  ritare.drawImage(bild, 0, 0);

  return duk;
}

/** Turns the canvas so that drawing the picture at 0,0 lands it upright. */
function vridUnderlag(
  ritare: CanvasRenderingContext2D,
  bild: ImageBitmap,
  vridning: Vridning,
): void {
  switch (vridning) {
    case 90:
      ritare.translate(bild.height, 0);
      ritare.rotate(Math.PI / 2);
      break;
    case 180:
      ritare.translate(bild.width, bild.height);
      ritare.rotate(Math.PI);
      break;
    case 270:
      ritare.translate(0, bild.width);
      ritare.rotate(-Math.PI / 2);
      break;
    case 0:
      break;
  }
}

/**
 * The picture turned, as an object URL the crop view can show.
 *
 * Re-rendered from the original every time rather than turned again from the
 * last one, so four taps around the circle cost nothing in quality.
 */
export async function vridenForhandsvisning(
  fil: File,
  vridning: Vridning,
): Promise<string> {
  const bild = await avkoda(fil);
  try {
    const duk = maladuk(bild, { vridning });
    const blob = await new Promise<Blob | null>((klar) => {
      duk.toBlob(klar, 'image/jpeg', KVALITET);
    });
    if (blob === null) {
      throw new Error('Webbläsaren kunde inte visa bilden.');
    }
    return URL.createObjectURL(blob);
  } finally {
    bild.close();
  }
}

/** True for what {@link forberedUnderlag} will accept at all. */
export function garAttLagra(fil: File): boolean {
  return fil.type.startsWith('image/') || arUnderlagstyp(fil.type);
}

async function avkoda(fil: File): Promise<ImageBitmap> {
  try {
    // A phone writes the orientation into EXIF rather than into the pixels,
    // so a portrait photograph would otherwise be stored on its side.
    return await createImageBitmap(fil, { imageOrientation: 'from-image' });
  } catch {
    /*
     * HEIC is the case that lands here: an iPhone usually hands over JPEG,
     * but a file picked out of Filer can still be HEIC, and no browser but
     * Safari decodes it. Hard rule 11 - say so rather than store nothing.
     */
    throw new Error(
      `Webbläsaren kunde inte läsa bilden "${fil.name}". Om den är i HEIC-format, ` +
        'ta om bilden med kameran i appen eller spara om den som JPEG först.',
    );
  }
}

async function tillJpeg(duk: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob | null>((klar) => {
    duk.toBlob(klar, 'image/jpeg', KVALITET);
  });
  if (blob === null) {
    throw new Error('Webbläsaren kunde inte koda om bilden till JPEG.');
  }
  return blob.arrayBuffer();
}

function kontrolleraStorlek(byte: number, namn: string): void {
  if (byte > MAX_UNDERLAG_BYTES) {
    throw new RangeError(
      `"${namn}" är ${Math.round(byte / 1024 / 1024)} MB, vilket är större än ` +
        `gränsen på ${MAX_UNDERLAG_BYTES / 1024 / 1024} MB för ett underlag.`,
    );
  }
}

/**
 * Local thresholding, the Sauvola way.
 *
 * A photographed receipt is lit unevenly - a hand, a lamp, the shadow of the
 * phone itself - and a single threshold for the whole picture then either
 * loses the text in the shadow or fills the bright half with noise. Sauvola
 * compares each pixel with the mean and the spread of its own neighbourhood
 * instead, so the paper stays white on both sides of a shadow.
 *
 * Measured against the same photograph: Tesseract's confidence went from 68
 * to 84, the reading took half the time, and four lines that had been dropped
 * entirely came back - among them the VAT heading, which is the difference
 * between finding the VAT and not.
 *
 * The means come from integral images, so the window size costs nothing: the
 * sum over any rectangle is four lookups whatever its size.
 */
export function trosklaLokalt(
  gra: Uint8ClampedArray,
  bredd: number,
  hojd: number,
  fonster: number,
  k = SAUVOLA_K,
): Uint8ClampedArray {
  const radbredd = bredd + 1;
  const summa = new Float64Array(radbredd * (hojd + 1));
  const kvadratsumma = new Float64Array(radbredd * (hojd + 1));

  for (let y = 0; y < hojd; y += 1) {
    let radsumma = 0;
    let radkvadrat = 0;
    for (let x = 0; x < bredd; x += 1) {
      const varde = gra[y * bredd + x] ?? 0;
      radsumma += varde;
      radkvadrat += varde * varde;
      const i = (y + 1) * radbredd + (x + 1);
      summa[i] = (summa[i - radbredd] ?? 0) + radsumma;
      kvadratsumma[i] = (kvadratsumma[i - radbredd] ?? 0) + radkvadrat;
    }
  }

  const halva = Math.floor(fonster / 2);
  const ut = new Uint8ClampedArray(bredd * hojd);

  for (let y = 0; y < hojd; y += 1) {
    const y1 = Math.max(0, y - halva);
    const y2 = Math.min(hojd - 1, y + halva);
    for (let x = 0; x < bredd; x += 1) {
      const x1 = Math.max(0, x - halva);
      const x2 = Math.min(bredd - 1, x + halva);
      const antal = (x2 - x1 + 1) * (y2 - y1 + 1);

      const a = y1 * radbredd + x1;
      const b = y1 * radbredd + x2 + 1;
      const c = (y2 + 1) * radbredd + x1;
      const d = (y2 + 1) * radbredd + x2 + 1;

      const medel =
        ((summa[d] ?? 0) - (summa[b] ?? 0) - (summa[c] ?? 0) + (summa[a] ?? 0)) / antal;
      const kvadratmedel =
        ((kvadratsumma[d] ?? 0) -
          (kvadratsumma[b] ?? 0) -
          (kvadratsumma[c] ?? 0) +
          (kvadratsumma[a] ?? 0)) /
        antal;

      // Spridningen i fönstret; negativ bara genom avrundning.
      const spridning = Math.sqrt(Math.max(0, kvadratmedel - medel * medel));
      const trosk = medel * (1 + k * (spridning / SAUVOLA_R - 1));
      ut[y * bredd + x] = (gra[y * bredd + x] ?? 0) > trosk ? 255 : 0;
    }
  }

  return ut;
}

/**
 * The window a pixel is judged against, in pixels.
 *
 * Wide enough to hold a character and its paper, narrow enough that a shadow
 * edge is local. A fiftieth of the width lands around 40 pixels on a receipt
 * scaled to 2000, which is what was measured; the bounds keep a very small or
 * very large picture sane.
 */
export function fonsterstorlek(bredd: number): number {
  const forslag = Math.round(bredd / 50);
  const begransat = Math.max(15, Math.min(81, forslag));
  // Odd, so the window has a middle.
  return begransat % 2 === 0 ? begransat + 1 : begransat;
}

/** Sauvola's own constants, at the values the measurement was made with. */
const SAUVOLA_K = 0.28;
const SAUVOLA_R = 128;

/**
 * The picture as OCR should see it: grey, and locally thresholded.
 *
 * Only for reading. What is stored stays the photograph - a binarised image
 * is a rendering of räkenskapsinformation, not the thing itself, and
 * bokföringslagen 7 kap. 2 § asks for what arrived.
 */
export async function forOcr(data: Uint8Array, mime: string): Promise<Blob> {
  const bild = await createImageBitmap(new Blob([data as BlobPart], { type: mime }));
  try {
    const duk = document.createElement('canvas');
    duk.width = bild.width;
    duk.height = bild.height;
    const ritare = duk.getContext('2d', { willReadFrequently: true });
    if (ritare === null) {
      throw new Error('Webbläsaren kunde inte behandla bilden inför läsningen.');
    }
    ritare.drawImage(bild, 0, 0);

    const punkter = ritare.getImageData(0, 0, duk.width, duk.height);
    const gra = new Uint8ClampedArray(duk.width * duk.height);
    for (let i = 0; i < gra.length; i += 1) {
      // Rec. 601 luma, which is what every OCR pipeline greys with.
      const r = punkter.data[i * 4] ?? 0;
      const g = punkter.data[i * 4 + 1] ?? 0;
      const b = punkter.data[i * 4 + 2] ?? 0;
      gra[i] = (r * 299 + g * 587 + b * 114) / 1000;
    }

    const svartvit = trosklaLokalt(gra, duk.width, duk.height, fonsterstorlek(duk.width));
    for (let i = 0; i < svartvit.length; i += 1) {
      const varde = svartvit[i] ?? 0;
      punkter.data[i * 4] = varde;
      punkter.data[i * 4 + 1] = varde;
      punkter.data[i * 4 + 2] = varde;
      punkter.data[i * 4 + 3] = 255;
    }
    ritare.putImageData(punkter, 0, 0);

    const blob = await new Promise<Blob | null>((klar) => duk.toBlob(klar, 'image/png'));
    if (blob === null) {
      throw new Error('Webbläsaren kunde inte behandla bilden inför läsningen.');
    }
    return blob;
  } finally {
    bild.close();
  }
}

/**
 * What is wrong with a picture, when something is.
 *
 * Measured before it is stored, because that is the only moment when it can
 * be taken again: the receipt is still in the hand, and afterwards the
 * information is not in the picture to recover. Every paper on reading
 * receipts lands on the same conclusion - the input image decides the
 * outcome, not the cleverness afterwards.
 */
export type Bildomdome = 'duger' | 'mork' | 'suddig' | 'liten';

/**
 * The thresholds, taken from four photographed receipts with known outcomes.
 *
 * Measured in the browser, on the same four:
 *
 *     dark car, unreadable      median  70   sharpness  1,4
 *     fuel receipt, read        median 179   sharpness  5,5
 *     A4 with a slip, unreadable median 177  sharpness 23,2
 *     farm shop, read           median 172   sharpness  7,1
 *
 * The limits sit between the two groups rather than at round numbers, and
 * with room to spare on the side of letting a picture through: a poor
 * photograph of a receipt is worth more than no photograph.
 *
 * What no measure here catches is a receipt that is simply small in the
 * frame: an A4 photographed whole read no better than the dark one, while
 * measuring bright and sharp. That is a composition, and the reading itself
 * is what reports it.
 */
const MINSTA_MEDIAN = 120;
const MINSTA_SKARPA = 3;
const MINSTA_PUNKTER = 500_000;

/** Judges a greyscale image on brightness, sharpness and size. */
export function bedomBild(
  gra: Uint8ClampedArray,
  bredd: number,
  hojd: number,
): Bildomdome {
  if (bredd * hojd < MINSTA_PUNKTER) {
    return 'liten';
  }

  const sorterad = Uint8ClampedArray.from(gra).sort();
  const median = sorterad[Math.floor(sorterad.length / 2)] ?? 0;
  if (median < MINSTA_MEDIAN) {
    return 'mork';
  }

  const p05 = sorterad[Math.floor(sorterad.length * 0.05)] ?? 0;
  const p95 = sorterad[Math.floor(sorterad.length * 0.95)] ?? 255;
  if (skarpa(gra, bredd, hojd, Math.max(1, p95 - p05)) < MINSTA_SKARPA) {
    return 'suddig';
  }

  return 'duger';
}

/**
 * How sharp the picture is: the spread of a Laplacian, relative to the
 * picture's own contrast.
 *
 * Relative on purpose. An absolute figure calls every dim photograph blurred,
 * and dimness is a different fault with a different remedy - the point is
 * whether the edges are crisp for the light there was.
 */
function skarpa(
  gra: Uint8ClampedArray,
  bredd: number,
  hojd: number,
  spann: number,
): number {
  let summa = 0;
  let kvadratsumma = 0;
  let antal = 0;

  for (let y = 1; y < hojd - 1; y += 1) {
    for (let x = 1; x < bredd - 1; x += 1) {
      const i = y * bredd + x;
      const kant =
        4 * (gra[i] ?? 0) -
        (gra[i - 1] ?? 0) -
        (gra[i + 1] ?? 0) -
        (gra[i - bredd] ?? 0) -
        (gra[i + bredd] ?? 0);
      summa += kant;
      kvadratsumma += kant * kant;
      antal += 1;
    }
  }

  if (antal === 0) {
    return 0;
  }
  const medel = summa / antal;
  const varians = kvadratsumma / antal - medel * medel;
  return (varians / (spann * spann)) * 100;
}

/**
 * Judges the picture as it will be stored: turned, cropped and scaled.
 *
 * The crop is the half that matters - a receipt filling the frame is a
 * different picture from the table it was lying on - so the same pipeline
 * runs first and the verdict is passed on what comes out of it.
 */
export async function bedomUnderlag(
  fil: File,
  forberedelse: Forberedelse = {},
): Promise<Bildomdome> {
  if (!fil.type.startsWith('image/')) {
    return 'duger';
  }

  const bild = await avkoda(fil);
  try {
    const duk = maladuk(bild, forberedelse);
    const ritare = duk.getContext('2d', { willReadFrequently: true });
    if (ritare === null) {
      return 'duger';
    }
    const punkter = ritare.getImageData(0, 0, duk.width, duk.height);
    const gra = new Uint8ClampedArray(duk.width * duk.height);
    for (let i = 0; i < gra.length; i += 1) {
      gra[i] =
        ((punkter.data[i * 4] ?? 0) * 299 +
          (punkter.data[i * 4 + 1] ?? 0) * 587 +
          (punkter.data[i * 4 + 2] ?? 0) * 114) /
        1000;
    }
    return bedomBild(gra, duk.width, duk.height);
  } catch {
    // A picture that cannot be judged is stored rather than refused.
    return 'duger';
  } finally {
    bild.close();
  }
}
