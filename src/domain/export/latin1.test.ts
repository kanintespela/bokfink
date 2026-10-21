import { describe, expect, it } from 'vitest';

import { kodaLatin1 } from './latin1';

describe('kodaLatin1', () => {
  it('encodes the Swedish letters as single bytes', () => {
    expect([...kodaLatin1('åäö')]).toEqual([0xe5, 0xe4, 0xf6]);
    expect([...kodaLatin1('ÅÄÖ')]).toEqual([0xc5, 0xc4, 0xd6]);
  });

  it('refuses a character the encoding cannot hold', () => {
    // A mangled name in a filed return is not something anyone notices in time.
    expect(() => kodaLatin1('€')).toThrow(RangeError);
    expect(() => kodaLatin1('😀')).toThrow(RangeError);
  });
});
