/**
 * Just enough JPEG to leave one alone.
 *
 * A receipt that arrives already the right way up and already small enough
 * needs nothing done to it, and decoding it only to encode it again costs a
 * generation of compression for no gain. Measured on a real BL export: the
 * round trip at KVALITET turned a 116 780-byte photograph into a 130 378-byte
 * one that was measurably worse - larger and softer, because the file was
 * already compressed harder than we would compress it.
 *
 * So the bytes are passed through instead. Two things the canvas used to do
 * on the way past have to be done here instead, or passing them through would
 * be a regression rather than a saving:
 *
 *   - the orientation has to be read, because a photograph that says "I am
 *     turned" is stored turned and displayed upright only by whoever honours
 *     the tag. Anything but upright still goes the long way round, which bakes
 *     the rotation into the pixels.
 *   - the metadata has to go. A phone writes the coordinates of the shop into
 *     the receipt it photographs, and an underlag is a thing that gets
 *     exported and mailed to an accountant.
 *
 * Written here rather than taken from a library: this reads two fields and
 * drops one segment, which is less code than choosing a dependency for it.
 */

/** The segments that carry metadata rather than picture. */
const APP1 = 0xe1;
const APP_FORSTA = 0xe0;
const APP_SISTA = 0xef;
const COM = 0xfe;
/** Start of scan: everything after it is entropy-coded picture. */
const SOS = 0xda;
const SOI = 0xd8;

/** Markers that stand alone, with no length after them. */
function utanLangd(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);
}

function arExif(data: Uint8Array, start: number, slut: number): boolean {
  // "Exif\0\0" is what makes an APP1 an Exif block rather than, say, XMP.
  const signatur = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  if (slut - start < signatur.length) {
    return false;
  }
  return signatur.every((byte, index) => data[start + index] === byte);
}

export function arJpeg(data: Uint8Array): boolean {
  return data.length > 3 && data[0] === 0xff && data[1] === SOI;
}

/**
 * Walks the marker segments before the picture data starts.
 *
 * Yields each segment's marker and the span of its payload. Stops at SOS,
 * because past that the bytes are no longer segments and scanning them for
 * 0xFF would find plenty that mean nothing.
 */
function* segment(
  data: Uint8Array,
): Generator<{ marker: number; start: number; slut: number; huvud: number }> {
  let i = 2;
  while (i + 3 < data.length) {
    if (data[i] !== 0xff) {
      return;
    }
    const marker = data[i + 1] ?? 0;
    if (marker === SOS || marker === 0xd9) {
      return;
    }
    if (utanLangd(marker)) {
      i += 2;
      continue;
    }
    const langd = ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0);
    if (langd < 2) {
      return;
    }
    yield { marker, start: i + 4, slut: i + 2 + langd, huvud: i };
    i += 2 + langd;
  }
}

/**
 * The Exif orientation, when the file states one.
 *
 * 1 is upright. Undefined means the file does not say, which is the same
 * thing in practice and is what a re-encoded file looks like.
 */
export function jpegOrientering(data: Uint8Array): number | undefined {
  if (!arJpeg(data)) {
    return undefined;
  }

  for (const del of segment(data)) {
    if (del.marker !== APP1 || !arExif(data, del.start, del.slut)) {
      continue;
    }
    // The TIFF header sits after "Exif\0\0" and every offset below is
    // relative to its own start, not to the file.
    const tiff = del.start + 6;
    if (tiff + 8 > del.slut) {
      return undefined;
    }
    const litet = data[tiff] === 0x49;
    const las16 = (vid: number): number =>
      litet
        ? ((data[vid + 1] ?? 0) << 8) | (data[vid] ?? 0)
        : ((data[vid] ?? 0) << 8) | (data[vid + 1] ?? 0);
    const las32 = (vid: number): number =>
      litet
        ? ((data[vid + 3] ?? 0) << 24) |
          ((data[vid + 2] ?? 0) << 16) |
          ((data[vid + 1] ?? 0) << 8) |
          (data[vid] ?? 0)
        : ((data[vid] ?? 0) << 24) |
          ((data[vid + 1] ?? 0) << 16) |
          ((data[vid + 2] ?? 0) << 8) |
          (data[vid + 3] ?? 0);

    if (las16(tiff + 2) !== 0x002a) {
      return undefined;
    }
    const katalog = tiff + las32(tiff + 4);
    if (katalog + 2 > del.slut) {
      return undefined;
    }
    const antal = las16(katalog);
    for (let post = 0; post < antal; post += 1) {
      const vid = katalog + 2 + post * 12;
      if (vid + 12 > del.slut) {
        return undefined;
      }
      // 0x0112 is Orientation; its value is a SHORT in the first two bytes.
      if (las16(vid) === 0x0112) {
        return las16(vid + 8);
      }
    }
    return undefined;
  }
  return undefined;
}

/**
 * The same picture with its metadata segments removed.
 *
 * Lossless: the compressed picture data is copied byte for byte and only the
 * APPn and comment segments around it are dropped. Nothing is re-encoded, so
 * this cannot soften a receipt the way a canvas round trip does.
 */
export function utanMetadata(data: Uint8Array): Uint8Array {
  if (!arJpeg(data)) {
    return data;
  }

  const behall: Array<{ fran: number; till: number }> = [];
  let kopierat = 2;
  for (const del of segment(data)) {
    const metadata =
      (del.marker >= APP_FORSTA && del.marker <= APP_SISTA) || del.marker === COM;
    if (!metadata) {
      continue;
    }
    if (del.huvud > kopierat) {
      behall.push({ fran: kopierat, till: del.huvud });
    }
    kopierat = del.slut;
  }
  if (behall.length === 0 && kopierat === 2) {
    return data;
  }
  behall.push({ fran: kopierat, till: data.length });

  const langd = 2 + behall.reduce((summa, del) => summa + (del.till - del.fran), 0);
  const ut = new Uint8Array(langd);
  ut[0] = 0xff;
  ut[1] = SOI;
  let vid = 2;
  for (const del of behall) {
    ut.set(data.subarray(del.fran, del.till), vid);
    vid += del.till - del.fran;
  }
  return ut;
}
