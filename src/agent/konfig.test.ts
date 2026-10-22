import { describe, expect, it } from 'vitest';

import { tolkaKonfig } from './konfig';

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
   * The passphrase is the only thing between the server and the books. A
   * file every account on the machine can read does not keep it.
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
    ).toThrow('epost, losenord, losenfras');
  });

  it('says when the file is not JSON', () => {
    expect(() => tolkaKonfig('/k.json', { lage: 0o600, text: 'url=x' })).toThrow(
      'inte giltig JSON',
    );
  });
});
