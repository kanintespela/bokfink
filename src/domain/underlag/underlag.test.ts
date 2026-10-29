import fc from 'fast-check';
import { datum } from '../tid/datum';
import { describe, expect, it } from 'vitest';

import type { Uuid } from '../id/uuidv7';
import {
  arOkopplat,
  farTasBort,
  frikoppla,
  koppla,
  MAX_UNDERLAG_BYTES,
  sattForfallodag,
  sattText,
  sha256,
  skapaUnderlag,
} from './underlag';

const HASH = 'a'.repeat(64);

function underlag(overstyr: Partial<Parameters<typeof skapaUnderlag>[0]> = {}) {
  return skapaUnderlag({
    id: '019b76da-a800-7000-8000-000000000001' as Uuid,
    sha256: sha256(HASH),
    mime: 'image/jpeg',
    storlek: 120_000,
    filnamn: 'kvitto.jpg',
    tillagd: '2026-09-05T08:17:05.123Z',
    ...overstyr,
  });
}

const verifikatId = (n: number) =>
  `019b76da-a800-7000-8000-${String(n).padStart(12, '0')}` as Uuid;

describe('sha256', () => {
  it('accepts 64 lowercase hex characters', () => {
    expect(sha256(HASH)).toBe(HASH);
  });

  /*
   * Uppercase is refused rather than folded. Two spellings of one hash would
   * mean two rows for one file, and content addressing stops working the
   * moment the address is not unique.
   */
  it('refuses anything that is not one', () => {
    expect(() => sha256(HASH.toUpperCase())).toThrow(TypeError);
    expect(() => sha256('a'.repeat(63))).toThrow(TypeError);
    expect(() => sha256('')).toThrow(TypeError);
  });
});

describe('skapaUnderlag', () => {
  it('starts out attached to nothing', () => {
    const post = underlag();
    expect(post.verifikat).toEqual([]);
    expect(arOkopplat(post)).toBe(true);
  });

  it('trims the file name', () => {
    expect(underlag({ filnamn: '  kvitto.jpg  ' }).filnamn).toBe('kvitto.jpg');
  });

  /*
   * HEIC is what an iPhone produces by default, and it is refused here on
   * purpose: the camera layer converts before storing, so that an archive
   * opened in seven years does not depend on a format one vendor decides to
   * support.
   */
  it('refuses a file type that cannot be archived', () => {
    expect(() => underlag({ mime: 'image/heic' })).toThrow(/image\/heic/);
    expect(() => underlag({ mime: 'text/html' })).toThrow(TypeError);
  });

  it('refuses an empty or impossible size', () => {
    expect(() => underlag({ storlek: 0 })).toThrow(RangeError);
    expect(() => underlag({ storlek: -1 })).toThrow(RangeError);
    expect(() => underlag({ storlek: 1.5 })).toThrow(RangeError);
  });

  it('refuses a file larger than the storage budget allows', () => {
    expect(() => underlag({ storlek: MAX_UNDERLAG_BYTES + 1 })).toThrow(RangeError);
    expect(() => underlag({ storlek: MAX_UNDERLAG_BYTES })).not.toThrow();
  });

  it('refuses a blank file name', () => {
    expect(() => underlag({ filnamn: '   ' })).toThrow(TypeError);
  });
});

describe('koppla', () => {
  it('attaches the underlag to a verifikat', () => {
    const post = koppla(underlag(), verifikatId(1));
    expect(post.verifikat).toEqual([verifikatId(1)]);
    expect(arOkopplat(post)).toBe(false);
  });

  it('carries several verifikat, because one receipt can cover two bookings', () => {
    const post = koppla(koppla(underlag(), verifikatId(1)), verifikatId(2));
    expect(post.verifikat).toEqual([verifikatId(1), verifikatId(2)]);
  });

  it('leaves the row untouched when the link is already there', () => {
    const en = koppla(underlag(), verifikatId(1));
    expect(koppla(en, verifikatId(1))).toBe(en);
  });

  /*
   * The invariant sync depends on: two devices that make the same links in
   * different orders have to end up with the same row, or merging their logs
   * would produce a difference that is not a difference.
   */
  it('gives the same row whatever order the links arrive in', () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 8 })
          .chain((nummer) =>
            fc.tuple(
              fc.constant(nummer),
              fc.shuffledSubarray(nummer, {
                minLength: nummer.length,
                maxLength: nummer.length,
              }),
            ),
          ),
        ([nummer, blandat]) => {
          const lank = (nummer: readonly number[]) =>
            nummer.reduce((post, n) => koppla(post, verifikatId(n)), underlag());
          expect(lank(blandat).verifikat).toEqual(lank(nummer).verifikat);
        },
      ),
    );
  });
});

describe('frikoppla', () => {
  it('removes one link and keeps the rest', () => {
    const post = koppla(koppla(underlag(), verifikatId(1)), verifikatId(2));
    expect(frikoppla(post, verifikatId(1)).verifikat).toEqual([verifikatId(2)]);
  });

  it('does nothing when the link is not there', () => {
    const post = underlag();
    expect(frikoppla(post, verifikatId(9))).toBe(post);
  });
});

describe('sattText', () => {
  it('records what OCR read', () => {
    expect(sattText(underlag(), 'ICA Kvantum 249,00').text).toBe('ICA Kvantum 249,00');
  });
});

describe('sattForfallodag', () => {
  it('sets a due date and takes it away again', () => {
    const satt = sattForfallodag(underlag(), datum('2026-03-15'));
    expect(satt.forfallodag).toBe('2026-03-15');

    const borttagen = sattForfallodag(satt, undefined);
    expect(borttagen).toEqual(underlag());
    expect('forfallodag' in borttagen).toBe(false);
  });
});

describe('farTasBort', () => {
  /*
   * The line between a photograph and räkenskapsinformation, and it is the
   * link that decides which one a picture is.
   */
  const ingetUtkast = () => false;

  it('lets a picture nobody has booked be thrown away', () => {
    expect(farTasBort(underlag(), ingetUtkast)).toBe(true);
  });

  it('keeps what a verifikat rests on', () => {
    expect(farTasBort(koppla(underlag(), verifikatId(1)), ingetUtkast)).toBe(false);
  });

  /* A draft is a suggestion, not a booking; its receipt is still a picture. */
  it('lets a picture only drafts have claimed be thrown away', () => {
    const utkast = verifikatId(1);
    const post = koppla(underlag(), utkast);
    expect(farTasBort(post, (id) => id === utkast)).toBe(true);
    expect(farTasBort(koppla(post, verifikatId(2)), (id) => id === utkast)).toBe(false);
  });
});
