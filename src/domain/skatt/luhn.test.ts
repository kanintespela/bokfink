import { describe, expect, it } from 'vitest';

import { harGiltigKontrollsiffra } from './luhn';

describe('harGiltigKontrollsiffra', () => {
  it.each(['1212121212', '7001011233', '5560360793'])('accepts %s', (nummer) => {
    expect(harGiltigKontrollsiffra(nummer)).toBe(true);
  });

  it.each(['1212121213', '7001011239', '123', '', '12121212121', 'abcdefghij'])(
    'refuses %s',
    (nummer) => {
      expect(harGiltigKontrollsiffra(nummer)).toBe(false);
    },
  );
});
