import { crc32 } from './zip';

/**
 * Reading a ZIP that someone else made, for the SIE files in it.
 *
 * SIE-gruppen's own sample file, and what some programs hand over, comes as a
 * zip. The archive is untrusted input from outside, so nothing here believes
 * it: every offset and length is checked against the file before it is used,
 * every entry's size against a ceiling, every inflated entry against the size
 * the archive declared and its checksum, and what cannot be read safely is
 * refused with a reason in words instead of being half read.
 *
 * Only what a SIE file needs is supported: stored and deflated entries, and
 * nothing encrypted, split over several disks or in the 64-bit form. The
 * inflating itself is handed in, since a browser's decompression is not
 * something the domain may call (src/platform/zip.ts).
 */

/** Inflates a raw deflate stream, refusing to produce more than `hogst` bytes. */
export type Inflate = (data: Uint8Array, hogst: number) => Promise<Uint8Array>;

export class ZipFel extends Error {
  constructor(orsak: string) {
    super(`Zip-filen går inte att läsa: ${orsak}`);
    this.name = 'ZipFel';
  }
}

/** The most one entry may unpack to. A SIE file of tens of megabytes is already a lot. */
export const HOGSTA_STORLEK_PER_FIL = 64 * 1024 * 1024;
/** The most all the entries read from one archive may unpack to. */
export const HOGSTA_STORLEK_TOTALT = 128 * 1024 * 1024;
const HOGSTA_ANTAL_POSTER = 10_000;

const LOKAL_SIGNATUR = 0x04034b50;
const CENTRAL_SIGNATUR = 0x02014b50;
const SLUT_SIGNATUR = 0x06054b50;
const SLUT_LANGD = 22;
/** A comment after the end record can be 65 535 bytes, so that far back is searched. */
const LANGSTA_KOMMENTAR = 0xffff;

/** Whether the bytes begin the way a zip does, which is what tells it from a SIE file. */
export function arZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06)
  );
}

export interface Zipinnehall {
  readonly namn: string;
  readonly data: Uint8Array;
}

/**
 * The entries `valj` picks, unpacked, in the archive's own order.
 *
 * Directories are not entries. An entry the caller does not pick is never
 * unpacked, so a large file beside the SIE file costs nothing.
 */
export async function lasZipposter(
  zip: Uint8Array,
  inflate: Inflate,
  valj: (namn: string) => boolean,
): Promise<Zipinnehall[]> {
  const vy = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const lasU16 = (pos: number) => {
    kraver(pos >= 0 && pos + 2 <= zip.length, 'filen slutar mitt i en post');
    return vy.getUint16(pos, true);
  };
  const lasU32 = (pos: number) => {
    kraver(pos >= 0 && pos + 4 <= zip.length, 'filen slutar mitt i en post');
    return vy.getUint32(pos, true);
  };

  const slut = hittaSlutpost(zip, lasU32);
  kraver(
    lasU16(slut + 4) === 0 && lasU16(slut + 6) === 0,
    'arkivet är delat på flera filer',
  );
  const antal = lasU16(slut + 10);
  const katalogStorlek = lasU32(slut + 12);
  const katalogStart = lasU32(slut + 16);
  kraver(
    antal !== 0xffff && katalogStorlek !== 0xffffffff && katalogStart !== 0xffffffff,
    'arkivet är i 64-bitsformat, som inte stöds',
  );
  kraver(antal <= HOGSTA_ANTAL_POSTER, `arkivet har över ${HOGSTA_ANTAL_POSTER} poster`);
  kraver(
    katalogStart + katalogStorlek <= slut,
    'innehållsförteckningen ligger utanför filen',
  );

  const poster: Zipinnehall[] = [];
  let totalt = 0;
  let pos = katalogStart;
  for (let i = 0; i < antal; i += 1) {
    kraver(lasU32(pos) === CENTRAL_SIGNATUR, `post ${i + 1} i förteckningen är skadad`);
    const flaggor = lasU16(pos + 8);
    const metod = lasU16(pos + 10);
    const crc = lasU32(pos + 16);
    const packadStorlek = lasU32(pos + 20);
    const storlek = lasU32(pos + 24);
    const namnlangd = lasU16(pos + 28);
    const extralangd = lasU16(pos + 30);
    const kommentarlangd = lasU16(pos + 32);
    const lokalPosition = lasU32(pos + 42);
    kraver(pos + 46 + namnlangd <= zip.length, 'ett filnamn slutar utanför filen');
    const namn = new TextDecoder().decode(zip.subarray(pos + 46, pos + 46 + namnlangd));
    pos += 46 + namnlangd + extralangd + kommentarlangd;

    if (namn.endsWith('/') || !valj(namn)) {
      continue;
    }
    kraver((flaggor & 1) === 0, `"${namn}" är lösenordsskyddad`);
    kraver(
      packadStorlek !== 0xffffffff &&
        storlek !== 0xffffffff &&
        lokalPosition !== 0xffffffff,
      `"${namn}" är i 64-bitsformat, som inte stöds`,
    );
    kraver(
      storlek <= HOGSTA_STORLEK_PER_FIL,
      `"${namn}" blir över ${Math.floor(HOGSTA_STORLEK_PER_FIL / (1024 * 1024))} MB uppackad`,
    );
    totalt += storlek;
    kraver(
      totalt <= HOGSTA_STORLEK_TOTALT,
      `filerna blir över ${Math.floor(HOGSTA_STORLEK_TOTALT / (1024 * 1024))} MB uppackade`,
    );

    // Sizes come from the directory: a local header of an archive written in one
    // pass can say zero for them, with the real figures after the data.
    kraver(lasU32(lokalPosition) === LOKAL_SIGNATUR, `"${namn}" pekar på en skadad post`);
    const dataStart =
      lokalPosition + 30 + lasU16(lokalPosition + 26) + lasU16(lokalPosition + 28);
    kraver(dataStart + packadStorlek <= zip.length, `"${namn}" är avbruten`);
    const packad = zip.subarray(dataStart, dataStart + packadStorlek);

    let data: Uint8Array;
    if (metod === 0) {
      kraver(
        packadStorlek === storlek,
        `"${namn}" har olika storlek lagrad och uppackad`,
      );
      data = packad.slice();
    } else if (metod === 8) {
      data = await inflate(packad, storlek);
    } else {
      throw new ZipFel(
        `"${namn}" är packad på ett sätt som inte stöds (metod ${metod}).`,
      );
    }
    kraver(data.length === storlek, `"${namn}" blev inte så stor som arkivet säger`);
    kraver(crc32(data) === crc, `"${namn}" är skadad (kontrollsumman stämmer inte)`);
    poster.push({ namn, data });
  }
  return poster;
}

function hittaSlutpost(zip: Uint8Array, lasU32: (pos: number) => number): number {
  kraver(zip.length >= SLUT_LANGD, 'filen är för kort');
  const tidigast = Math.max(0, zip.length - SLUT_LANGD - LANGSTA_KOMMENTAR);
  for (let pos = zip.length - SLUT_LANGD; pos >= tidigast; pos -= 1) {
    if (lasU32(pos) === SLUT_SIGNATUR) {
      const kommentarlangd = zip[pos + 20]! | (zip[pos + 21]! << 8);
      if (pos + SLUT_LANGD + kommentarlangd === zip.length) {
        return pos;
      }
    }
  }
  throw new ZipFel('slutet på arkivet hittades inte.');
}

function kraver(villkor: boolean, orsak: string): asserts villkor {
  if (!villkor) {
    throw new ZipFel(`${orsak}.`);
  }
}

const SIEFIL = /\.(se|si|sie)$/i;

export interface Siefiler {
  readonly filer: readonly Uint8Array[];
  /** Names of the SIE files that came out of an archive, for saying so. */
  readonly urZip: readonly string[];
}

/**
 * The SIE files among what was picked, with any zip opened.
 *
 * A file that is not a zip passes through untouched. From a zip comes every
 * entry named .se, .si or .sie, except the copies a Mac adds under
 * __MACOSX/ and those that start with "._". A zip with none is an error that
 * says so, rather than an import of nothing.
 */
export async function siefilerUrValda(
  valda: readonly { readonly namn: string; readonly innehall: Uint8Array }[],
  inflate: Inflate,
): Promise<Siefiler> {
  const filer: Uint8Array[] = [];
  const urZip: string[] = [];
  for (const fil of valda) {
    if (!arZip(fil.innehall)) {
      filer.push(fil.innehall);
      continue;
    }
    const poster = await lasZipposter(fil.innehall, inflate, (namn) => {
      const sist = namn.split('/').pop() ?? namn;
      return SIEFIL.test(namn) && !namn.startsWith('__MACOSX/') && !sist.startsWith('._');
    });
    if (poster.length === 0) {
      throw new ZipFel(`${fil.namn} innehåller ingen SIE-fil (.se, .si eller .sie).`);
    }
    for (const post of poster) {
      filer.push(post.data);
      urZip.push(post.namn);
    }
  }
  return { filer, urZip };
}
