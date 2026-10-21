import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { franBase64, tillBase64 } from './base64';

describe('base64', () => {
  it('round-trips every byte value', () => {
    const alla = new Uint8Array(256).map((_, i) => i);
    expect(franBase64(tillBase64(alla))).toEqual(alla);
  });

  it('round-trips nothing', () => {
    expect(franBase64(tillBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });

  /*
   * A receipt is far larger than one chunk, and encoding in chunks is exactly
   * the kind of thing that works until the file is big enough.
   */
  it('round-trips data larger than one chunk', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 9000, maxLength: 20_000 }), (data) => {
        expect(franBase64(tillBase64(data))).toEqual(data);
      }),
      { numRuns: 5 },
    );
  });
});
