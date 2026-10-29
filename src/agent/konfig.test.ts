import { describe, expect, it } from 'vitest';

import { tolkaKonfig, tolkaVaktkonfig } from './konfig';

const TEXT = JSON.stringify({
  url: 'https://raspberrypi.example.ts.net',
  epost: 'agare@example.se',
  losenord: 'hemligt',
  losenfras: 'en lång lösenfras',
});

describe('tolkaKonfig', () => {
  it('reads a file only its owner can read, with the device name defaulted', () => {
    expect(tolkaKonfig('/k.json', { lage: 0o100600, text: TEXT })).toEqual({
      url: 'https://raspberrypi.example.ts.net',
      epost: 'agare@example.se',
      losenord: 'hemligt',
      losenfras: 'en lång lösenfras',
      enhet: 'claude-pi',
    });
  });

  /*
   * The file holds the login to the server, and perhaps the passphrase. A
   * file every account on the machine can read keeps neither.
   */
  it('refuses a file others can read', () => {
    expect(() => tolkaKonfig('/k.json', { lage: 0o100644, text: TEXT })).toThrow(
      'chmod 600 /k.json',
    );
    expect(() => tolkaKonfig('/k.json', { lage: 0o100640, text: TEXT })).toThrow(
      'chmod 600',
    );
  });

  it('says which fields are missing', () => {
    expect(() =>
      tolkaKonfig('/k.json', { lage: 0o600, text: '{"url":"https://a.se"}' }),
    ).toThrow('epost, losenord.');
  });

  /* Decision X: books that sync unencrypted have no passphrase to give. */
  it('reads a file without a passphrase', () => {
    const utan = JSON.stringify({ ...JSON.parse(TEXT), losenfras: undefined });

    expect(tolkaKonfig('/k.json', { lage: 0o600, text: utan }).losenfras).toBeUndefined();
  });

  it('says when the file is not JSON', () => {
    expect(() => tolkaKonfig('/k.json', { lage: 0o600, text: 'url=x' })).toThrow(
      'inte giltig JSON',
    );
  });
});

describe('tolkaVaktkonfig', () => {
  it('fills in the limits that are left out', () => {
    expect(tolkaVaktkonfig('/v.json', '{"fran": "2026-10-28"}')).toEqual({
      fran: '2026-10-28',
      maxPerKorning: 3,
      maxPerDygn: 20,
      hermes: 'hermes',
      redovisningsmetod: 'kontantmetoden',
    });
  });

  it('says what is wrong with the file', () => {
    expect(() => tolkaVaktkonfig('/v.json', '{"fran": "28 okt"}')).toThrow('ÅÅÅÅ-MM-DD');
    expect(() => tolkaVaktkonfig('/v.json', 'fran=x')).toThrow('inte giltig JSON');
  });
});
