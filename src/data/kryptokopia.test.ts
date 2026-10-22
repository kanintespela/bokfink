import { describe, expect, it } from 'vitest';

import {
  arKrypterad,
  laspaket,
  OlasbarKrypteradKopiaError,
  paketera,
} from './kryptokopia';

const PAKET = {
  salt: Uint8Array.from([1, 2, 3, 4]),
  iterationer: 600_000,
  iv: Uint8Array.from([5, 6, 7]),
  chiffer: Uint8Array.from([8, 9]),
  skapad: '2026-09-06T12:00:00.000Z',
};

describe('paketera', () => {
  it('round-trips through the envelope', () => {
    expect(laspaket(paketera(PAKET))).toEqual(PAKET);
  });

  /*
   * The envelope says what it is in plain sight. Whoever finds the file in
   * seven years has to be able to tell what it is and what would open it, and
   * hiding the format protects nothing the key does not already protect.
   */
  it('says what it is and how it was encrypted', () => {
    const text = paketera(PAKET);

    expect(text).toContain('"format": "kontera-krypterad-sakerhetskopia"');
    expect(text).toContain('"algoritm": "PBKDF2-SHA256"');
    expect(text).toContain('"chiffer": "AES-GCM-256"');
    expect(text).toContain('"iterationer": 600000');
  });

  /*
   * The count travels with the file so it can be raised later without making
   * every backup taken before that unreadable.
   */
  it('carries the parameters rather than assuming them', () => {
    const gammal = { ...PAKET, iterationer: 100_000 };
    expect(laspaket(paketera(gammal)).iterationer).toBe(100_000);
  });

  it('keeps the date outside the encryption, so a folder can be sorted', () => {
    expect(paketera(PAKET)).toContain('"skapad": "2026-09-06T12:00:00.000Z"');
  });
});

describe('laspaket', () => {
  it('refuses a file that is not one of these', () => {
    for (const trasig of ['', 'inte json', '{}', '{"format":"kontera-backup"}']) {
      expect(() => laspaket(trasig)).toThrow(OlasbarKrypteradKopiaError);
    }
  });
});

describe('arKrypterad', () => {
  it('tells an encrypted backup from a plain one', () => {
    expect(arKrypterad(JSON.parse(paketera(PAKET)))).toBe(true);
    expect(arKrypterad({ format: 'kontera-backup' })).toBe(false);
    expect(arKrypterad(null)).toBe(false);
    expect(arKrypterad('text')).toBe(false);
  });
});
