import { delar, type Datum } from '../tid/datum';

/**
 * A minimal ZIP writer for the seven-year archive package.
 *
 * Hand-rolled rather than a dependency, on the same reasoning as the SIE and
 * eSKD writers: this is the one file that has to open on whatever computer
 * someone reaches for in 2033, without Kontera and quite possibly without
 * this project's dependency tree still being installable. A few hundred
 * lines that can be read end to end is worth more here than a library that
 * has to be trusted unread.
 *
 * Every entry is stored rather than compressed (method 0). The two things
 * that go in an archive - JPEG receipts and a PDF - are already compressed
 * formats, and the text files (SIE, checksums, read-me) are small. Skipping
 * DEFLATE removes the one part of the ZIP format that is genuinely fiddly to
 * get right, in exchange for a file that is a few percent larger.
 *
 * Filenames are restricted to printable ASCII and refused otherwise. The
 * UTF-8 language-encoding flag (bit 11) exists for exactly this problem, but
 * the Info-ZIP UnZip that ships with Debian - about as ordinary a tool as
 * this archive will ever meet - was built before that flag was widely
 * honoured and silently mangles an å, ä or ö in a filename despite it.
 * Every name this archive actually needs (a SHA-256, or a fixed literal like
 * "kontera.se") is ASCII already, so the restriction costs nothing and
 * closes off a failure mode nobody would notice until they needed the file.
 */

export interface Ziparkivfil {
  /** Forward-slash path inside the archive, e.g. "underlag/<sha256>.jpg". */
  readonly namn: string;
  readonly data: Uint8Array;
}

const CRC32_TABELL = byggCrc32Tabell();

function byggCrc32Tabell(): Uint32Array {
  const tabell = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tabell[n] = c >>> 0;
  }
  return tabell;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC32_TABELL[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * DOS date, the format every ZIP timestamp is written in.
 *
 * A single date for the whole archive rather than one per file: the archive
 * is a snapshot taken at export time, not a record of when each receipt was
 * originally added, and the log already carries that history.
 */
function dosDatum(datum: Datum): number {
  const { ar, manad, dag } = delar(datum);
  return ((Math.max(ar, 1980) - 1980) << 9) | (manad << 5) | dag;
}

/** Noon, so the archive's clock never reads midnight of the wrong day. */
const DOS_TID = (12 << 11) | (0 << 5) | 0;

const GENERAL_PURPOSE_FLAG_UTF8 = 0x0800;
const VERSION = 20;
const LOKAL_HEADER_STORLEK = 30;
const CENTRAL_HEADER_STORLEK = 46;
const EOCD_STORLEK = 22;

class Bufferskrivare {
  private readonly buffer: Uint8Array;
  private readonly vy: DataView;
  private pos = 0;

  constructor(storlek: number) {
    this.buffer = new Uint8Array(storlek);
    this.vy = new DataView(this.buffer.buffer);
  }

  u16(varde: number): void {
    this.vy.setUint16(this.pos, varde, true);
    this.pos += 2;
  }

  u32(varde: number): void {
    this.vy.setUint32(this.pos, varde, true);
    this.pos += 4;
  }

  bytes(data: Uint8Array): void {
    this.buffer.set(data, this.pos);
    this.pos += data.length;
  }

  get position(): number {
    return this.pos;
  }

  klar(): Uint8Array {
    if (this.pos !== this.buffer.length) {
      // A size mismatch here is a bug in this writer, not bad input - the
      // total was computed from the same entries that were then written.
      throw new Error(
        `Zip-arkivet fick fel storlek: skrev ${this.pos} byte, väntade ${this.buffer.length}.`,
      );
    }
    return this.buffer;
  }
}

interface Post {
  readonly namn: Uint8Array;
  readonly data: Uint8Array;
  readonly crc: number;
  readonly lokalOffset: number;
}

/**
 * Builds the ZIP as one buffer: every local file header and its bytes, then
 * the central directory that indexes them, then the record that says where
 * the central directory is. That trailing record is what every unzip tool
 * reads first - it seeks to the end, not the start.
 */
const ASCII_NAMN = /^[\x20-\x7e]+$/;

export function skrivZip(filer: readonly Ziparkivfil[], datum: Datum): Uint8Array {
  const kodare = new TextEncoder();
  const poster: Post[] = filer.map((fil) => {
    if (!ASCII_NAMN.test(fil.namn)) {
      throw new Error(
        `Filnamnet "${fil.namn}" i arkivet innehåller tecken som inte alla ` +
          'zip-verktyg tolkar lika. Använd bara ASCII i arkivnamn.',
      );
    }
    return {
      namn: kodare.encode(fil.namn),
      data: fil.data,
      crc: crc32(fil.data),
      lokalOffset: 0,
    };
  });

  let lokalStorlek = 0;
  let centralStorlek = 0;
  for (const post of poster) {
    lokalStorlek += LOKAL_HEADER_STORLEK + post.namn.length + post.data.length;
    centralStorlek += CENTRAL_HEADER_STORLEK + post.namn.length;
  }

  const skrivare = new Bufferskrivare(lokalStorlek + centralStorlek + EOCD_STORLEK);
  const datumKod = dosDatum(datum);

  const medOffset: Post[] = [];
  for (const post of poster) {
    const lokalOffset = skrivare.position;
    skrivare.u32(0x04034b50);
    skrivare.u16(VERSION);
    skrivare.u16(GENERAL_PURPOSE_FLAG_UTF8);
    skrivare.u16(0); // Store - no compression.
    skrivare.u16(DOS_TID);
    skrivare.u16(datumKod);
    skrivare.u32(post.crc);
    skrivare.u32(post.data.length);
    skrivare.u32(post.data.length);
    skrivare.u16(post.namn.length);
    skrivare.u16(0);
    skrivare.bytes(post.namn);
    skrivare.bytes(post.data);
    medOffset.push({ ...post, lokalOffset });
  }

  const centralDirektorietsBorjan = skrivare.position;
  for (const post of medOffset) {
    skrivare.u32(0x02014b50);
    skrivare.u16(VERSION);
    skrivare.u16(VERSION);
    skrivare.u16(GENERAL_PURPOSE_FLAG_UTF8);
    skrivare.u16(0);
    skrivare.u16(DOS_TID);
    skrivare.u16(datumKod);
    skrivare.u32(post.crc);
    skrivare.u32(post.data.length);
    skrivare.u32(post.data.length);
    skrivare.u16(post.namn.length);
    skrivare.u16(0); // Extra field length.
    skrivare.u16(0); // File comment length.
    skrivare.u16(0); // Disk number start.
    skrivare.u16(0); // Internal file attributes.
    skrivare.u32(0); // External file attributes.
    skrivare.u32(post.lokalOffset);
    skrivare.bytes(post.namn);
  }
  const centralDirektorietsStorlek = skrivare.position - centralDirektorietsBorjan;

  skrivare.u32(0x06054b50);
  skrivare.u16(0); // This disk.
  skrivare.u16(0); // Disk where the central directory starts.
  skrivare.u16(poster.length);
  skrivare.u16(poster.length);
  skrivare.u32(centralDirektorietsStorlek);
  skrivare.u32(centralDirektorietsBorjan);
  skrivare.u16(0); // Comment length.

  return skrivare.klar();
}
