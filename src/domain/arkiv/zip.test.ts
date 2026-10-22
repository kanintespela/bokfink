import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { datum } from '../tid/datum';
import { skrivZip, type Ziparkivfil } from './zip';
import { lasZip } from './zipTestReader';

const AR_2026 = datum('2026-09-08');

describe('skrivZip', () => {
  it('restores every name and every byte through a real reader', () => {
    const filer: Ziparkivfil[] = [
      { namn: 'kontera.se', data: new TextEncoder().encode('#FLAGGA 0\n') },
      {
        namn: 'LASMIG.txt',
        data: new TextEncoder().encode('Arkiv för Kontera – å, ä och ö i innehållet.'),
      },
      {
        namn: 'underlag/aa11bb22.jpg',
        data: Uint8Array.from({ length: 300 }, (_, i) => i % 256),
      },
    ];

    const lasta = lasZip(skrivZip(filer, AR_2026));

    expect(lasta.map((post) => post.namn)).toEqual(filer.map((fil) => fil.namn));
    for (const [i, post] of lasta.entries()) {
      expect(post.data).toEqual(filer[i]!.data);
    }
  });

  /*
   * A ZIP with nothing in it is still a valid ZIP - an empty end-of-central-
   * directory record - and the archive package can legitimately have no
   * underlag if none were ever attached.
   */
  it('writes a valid empty archive', () => {
    expect(lasZip(skrivZip([], AR_2026))).toEqual([]);
  });

  it('restores a zero-byte file', () => {
    const lasta = lasZip(
      skrivZip([{ namn: 'tomt.txt', data: new Uint8Array(0) }], AR_2026),
    );
    expect(lasta).toHaveLength(1);
    expect(lasta[0]!.data).toEqual(new Uint8Array(0));
  });

  /*
   * Debian's Info-ZIP UnZip 6.00 mangles a non-ASCII filename despite the
   * UTF-8 flag being set - checked by hand against the real binary. Every
   * name the archive package actually uses is ASCII already, so refusing
   * anything else here costs nothing and closes a failure mode that would
   * otherwise only surface seven years from now, on someone else's computer.
   */
  it('refuses a filename that is not plain ASCII', () => {
    expect(() =>
      skrivZip([{ namn: 'kvitto-å.jpg', data: new Uint8Array() }], AR_2026),
    ).toThrow(/ASCII/);
  });

  it('refuses a filename with a control character', () => {
    expect(() =>
      skrivZip([{ namn: 'rad\nbrytning.txt', data: new Uint8Array() }], AR_2026),
    ).toThrow(/ASCII/);
  });

  it('checksums each entry correctly, so a corrupted archive can be told apart from a good one', () => {
    const data = new TextEncoder().encode('520,31 kr');
    const [post] = lasZip(skrivZip([{ namn: 'belopp.txt', data }], AR_2026));

    // CRC-32 of "520,31 kr", cross-checked against Python's zlib.crc32.
    expect(post!.crc).toBe(0x33131c22);
  });

  it('produces the same bytes for the same input, so the archive is reproducible', () => {
    const filer: Ziparkivfil[] = [{ namn: 'a.txt', data: new TextEncoder().encode('a') }];
    expect(skrivZip(filer, AR_2026)).toEqual(skrivZip(filer, AR_2026));
  });

  it('round-trips any set of ASCII-named files', () => {
    const namn = fc
      .string({ minLength: 1, maxLength: 20 })
      .map((text) => text.replace(/[^\x20-\x7e]/g, '_') || '_')
      .filter((text) => text.trim().length > 0);

    fc.assert(
      fc.property(
        fc.uniqueArray(fc.tuple(namn, fc.uint8Array({ maxLength: 200 })), {
          selector: ([n]) => n,
          minLength: 0,
          maxLength: 8,
        }),
        (poster) => {
          const filer = poster.map(([n, data]) => ({ namn: n, data }));
          const lasta = lasZip(skrivZip(filer, AR_2026));

          expect(lasta.map((post) => post.namn)).toEqual(filer.map((fil) => fil.namn));
          for (const [i, post] of lasta.entries()) {
            expect(post.data).toEqual(filer[i]!.data);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
