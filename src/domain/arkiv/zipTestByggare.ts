import { deflateRawSync } from 'node:zlib';

import { crc32 } from './zip';

/**
 * A ZIP built by hand, only for tests.
 *
 * Written the way other programs write one - a local header and the data for
 * each entry, then the directory, then the end record - and independently of
 * zip.ts, so a reader is tested against the format and not against our own
 * writer. An entry can be made to say something untrue about itself.
 */
export interface Post {
  readonly namn: string;
  readonly data: Uint8Array;
  readonly metod?: 0 | 8 | 99;
  readonly flaggor?: number;
  /** What the directory says, when it is to differ from the truth. */
  readonly storlek?: number;
  readonly crc?: number;
  readonly lokalaStorlekarNoll?: boolean;
  readonly packad?: Uint8Array;
}

/**
 * A zip built by hand the way other programs build one: a local header and the
 * data for each entry, then the directory, then the end record. Written
 * independently of zip.ts so the reader is tested against the format and not
 * against our own writer.
 */
export function bygg(poster: readonly Post[], kommentar = ''): Uint8Array {
  const delar: number[] = [];
  const katalog: number[] = [];
  const u16 = (ut: number[], v: number) => ut.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (ut: number[], v: number) =>
    ut.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  const text = new TextEncoder();

  for (const post of poster) {
    const metod = post.metod ?? 8;
    const packad =
      post.packad ??
      (metod === 8 ? new Uint8Array(deflateRawSync(post.data)) : post.data);
    const namn = text.encode(post.namn);
    const crc = post.crc ?? crc32(post.data);
    const storlek = post.storlek ?? post.data.length;
    const lokalPosition = delar.length;

    u32(delar, 0x04034b50);
    u16(delar, 20);
    u16(delar, post.flaggor ?? 0);
    u16(delar, metod);
    u16(delar, 0);
    u16(delar, 0x21);
    u32(delar, post.lokalaStorlekarNoll === true ? 0 : crc);
    u32(delar, post.lokalaStorlekarNoll === true ? 0 : packad.length);
    u32(delar, post.lokalaStorlekarNoll === true ? 0 : storlek);
    u16(delar, namn.length);
    u16(delar, 4);
    delar.push(...namn, 0xca, 0xfe, 0, 0);
    delar.push(...packad);

    u32(katalog, 0x02014b50);
    u16(katalog, 20);
    u16(katalog, 20);
    u16(katalog, post.flaggor ?? 0);
    u16(katalog, metod);
    u16(katalog, 0);
    u16(katalog, 0x21);
    u32(katalog, crc);
    u32(katalog, packad.length);
    u32(katalog, storlek);
    u16(katalog, namn.length);
    u16(katalog, 0);
    u16(katalog, 0);
    u16(katalog, 0);
    u16(katalog, 0);
    u32(katalog, 0);
    u32(katalog, lokalPosition);
    katalog.push(...namn);
  }

  const kat = text.encode(kommentar);
  const slut: number[] = [];
  u32(slut, 0x06054b50);
  u16(slut, 0);
  u16(slut, 0);
  u16(slut, poster.length);
  u16(slut, poster.length);
  u32(slut, katalog.length);
  u32(slut, delar.length);
  u16(slut, kat.length);
  slut.push(...kat);
  return new Uint8Array([...delar, ...katalog, ...slut]);
}
