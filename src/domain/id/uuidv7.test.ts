import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { timestampOf, uuidv7, UUIDV7_RANDOM_BYTES, type Uuid } from './uuidv7';

const CANONICAL = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const MAX_TIMESTAMP_MS = 2 ** 48 - 1;

const bytes = (fill: number) => new Uint8Array(UUIDV7_RANDOM_BYTES).fill(fill);

/** Timestamps and randomness, as the generator takes them. */
const arbInputs = fc.tuple(
  fc.integer({ min: 0, max: MAX_TIMESTAMP_MS }),
  fc.uint8Array({ minLength: UUIDV7_RANDOM_BYTES, maxLength: 32 }),
);

describe('uuidv7', () => {
  it('produces the canonical form with version 7 and the RFC variant', () => {
    fc.assert(
      fc.property(arbInputs, ([ms, random]) => {
        expect(uuidv7(ms, random)).toMatch(CANONICAL);
      }),
    );
  });

  it('is a pure function of its arguments', () => {
    const ms = 1_767_225_600_000;
    expect(uuidv7(ms, bytes(0xab))).toBe(uuidv7(ms, bytes(0xab)));
  });

  it('round-trips the timestamp', () => {
    fc.assert(
      fc.property(arbInputs, ([ms, random]) => {
        expect(timestampOf(uuidv7(ms, random))).toBe(ms);
      }),
    );
  });

  it('sorts as a string in timestamp order', () => {
    fc.assert(
      fc.property(arbInputs, arbInputs, ([msA, randomA], [msB, randomB]) => {
        fc.pre(msA !== msB);
        const a = uuidv7(msA, randomA);
        const b = uuidv7(msB, randomB);
        // This is the property the sync log depends on: ordering by id is
        // ordering by creation time, with no separate sequence to agree on.
        expect(a < b).toBe(msA < msB);
      }),
    );
  });

  it('keeps the epoch and the last representable millisecond in range', () => {
    expect(timestampOf(uuidv7(0, bytes(0)))).toBe(0);
    expect(timestampOf(uuidv7(MAX_TIMESTAMP_MS, bytes(0xff)))).toBe(MAX_TIMESTAMP_MS);
  });

  it('refuses a timestamp that is not a whole number of milliseconds', () => {
    expect(() => uuidv7(1.5, bytes(0))).toThrow(TypeError);
    expect(() => uuidv7(Number.NaN, bytes(0))).toThrow(TypeError);
  });

  it('refuses a timestamp outside the 48 bits the format allows', () => {
    expect(() => uuidv7(-1, bytes(0))).toThrow(RangeError);
    expect(() => uuidv7(MAX_TIMESTAMP_MS + 1, bytes(0))).toThrow(RangeError);
  });

  it('refuses to build an identifier from too little randomness', () => {
    expect(() => uuidv7(0, new Uint8Array(UUIDV7_RANDOM_BYTES - 1))).toThrow(RangeError);
  });

  it('uses every random byte it asks for', () => {
    const low = uuidv7(0, bytes(0x00));
    const high = uuidv7(0, bytes(0xff));
    // Differing only in randomness must differ everywhere the format allows,
    // so no requested byte is silently dropped.
    expect(low).not.toBe(high);
    expect(timestampOf(low)).toBe(timestampOf(high));
  });
});

describe('timestampOf', () => {
  it('reads the timestamp out of a known identifier', () => {
    // 2026-01-01T00:00:00.000Z is 1767225600000 ms, which is 0x019b76daa800
    // across the leading 48 bits.
    const id = uuidv7(1_767_225_600_000, bytes(0x42));
    expect(id.startsWith('019b76da-a800-7')).toBe(true);
    expect(timestampOf(id as Uuid)).toBe(1_767_225_600_000);
  });
});
