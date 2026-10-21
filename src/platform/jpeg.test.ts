import { describe, expect, it } from 'vitest';

import { arJpeg, jpegOrientering, utanMetadata } from './jpeg';

/**
 * A minimal but structurally real JPEG.
 *
 * Built rather than committed as a fixture: what is being tested is the walk
 * over the segments, and a handful of bytes shows it more plainly than a
 * photograph would - and does not put a real receipt in the repository.
 */
function jpeg(segment: ReadonlyArray<readonly [number, readonly number[]]>): Uint8Array {
  const delar: number[] = [0xff, 0xd8];
  for (const [marker, nyttolast] of segment) {
    delar.push(0xff, marker);
    const langd = nyttolast.length + 2;
    delar.push((langd >> 8) & 0xff, langd & 0xff);
    delar.push(...nyttolast);
  }
  // SOS and a scrap of "picture", then end of image.
  delar.push(0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9);
  return new Uint8Array(delar);
}

/** An APP1 payload stating one orientation, little-endian. */
function exif(orientering: number): number[] {
  return [
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00, // "Exif\0\0"
    0x49,
    0x49,
    0x2a,
    0x00, // little-endian TIFF header
    0x08,
    0x00,
    0x00,
    0x00, // first directory at offset 8
    0x01,
    0x00, // one entry
    0x12,
    0x01, // tag 0x0112, Orientation
    0x03,
    0x00, // type SHORT
    0x01,
    0x00,
    0x00,
    0x00, // one value
    orientering & 0xff,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00, // no next directory
  ];
}

/** A quantisation table, standing in for the parts that must survive. */
const DQT: readonly number[] = [0x00, ...Array.from({ length: 64 }, (_, i) => i + 1)];

describe('arJpeg', () => {
  it('knows one by its start', () => {
    expect(arJpeg(jpeg([]))).toBe(true);
    expect(arJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(arJpeg(new Uint8Array([]))).toBe(false);
  });
});

describe('jpegOrientering', () => {
  it('reads the orientation a photograph states', () => {
    expect(jpegOrientering(jpeg([[0xe1, exif(6)]]))).toBe(6);
    expect(jpegOrientering(jpeg([[0xe1, exif(1)]]))).toBe(1);
  });

  it('says nothing when the file does not', () => {
    // What a re-encoded file looks like: no Exif at all.
    expect(jpegOrientering(jpeg([[0xdb, DQT]]))).toBeUndefined();
  });

  it('is not fooled by an APP1 that is not Exif', () => {
    const xmp = [0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f, 0x2f, 0x6e, 0x73];
    expect(jpegOrientering(jpeg([[0xe1, xmp]]))).toBeUndefined();
  });

  it('finds it past a JFIF block, which comes first in most files', () => {
    const jfif = [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01];
    expect(
      jpegOrientering(
        jpeg([
          [0xe0, jfif],
          [0xe1, exif(8)],
        ]),
      ),
    ).toBe(8);
  });

  it('does not walk off the end of a truncated file', () => {
    const hel = jpeg([[0xe1, exif(6)]]);
    for (let i = 2; i < hel.length; i += 1) {
      expect(() => jpegOrientering(hel.subarray(0, i))).not.toThrow();
    }
  });
});

describe('utanMetadata', () => {
  it('drops Exif and keeps the picture, byte for byte', () => {
    const med = jpeg([
      [0xe1, exif(1)],
      [0xdb, DQT],
    ]);
    const utan = utanMetadata(med);

    expect(utan.length).toBeLessThan(med.length);
    expect(jpegOrientering(utan)).toBeUndefined();
    // The quantisation table and everything after it survive unchanged.
    expect([...utan].join(',')).toContain([...DQT].join(','));
    expect([...utan.slice(-9)]).toEqual([
      0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9,
    ]);
  });

  it('drops a comment and a JFIF block too', () => {
    const med = jpeg([
      [0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00]],
      [0xfe, [0x68, 0x65, 0x6a]],
      [0xdb, DQT],
    ]);
    expect(utanMetadata(med).length).toBeLessThan(med.length);
  });

  it('leaves a file with nothing to drop exactly as it was', () => {
    const utan = jpeg([[0xdb, DQT]]);
    expect([...utanMetadata(utan)]).toEqual([...utan]);
  });

  it('leaves something that is not a JPEG alone', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect([...utanMetadata(png)]).toEqual([...png]);
  });

  it('is idempotent', () => {
    const med = jpeg([
      [0xe1, exif(1)],
      [0xdb, DQT],
    ]);
    const en = utanMetadata(med);
    expect([...utanMetadata(en)]).toEqual([...en]);
  });
});
