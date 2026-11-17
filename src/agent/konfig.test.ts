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
   * A server can hold several books. A file that names none leaves the
   * choice to each command (beslut AE); one that names a book makes it the
   * one used when a command does not say.
   */
  it('names a book only when the file does', () => {
    const annan = JSON.stringify({
      ...(JSON.parse(TEXT) as object),
      bok: '019b76da-a800-7000-8000-00000000b00c',
    });

    expect(tolkaKonfig('/k.json', { lage: 0o600, text: TEXT }).bok).toBeUndefined();
    expect(tolkaKonfig('/k.json', { lage: 0o600, text: annan }).bok).toBe(
      '019b76da-a800-7000-8000-00000000b00c',
    );
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
      bocker: {},
    });
  });

  it('reads what the owner says about single books', () => {
    const vakt = tolkaVaktkonfig(
      '/v.json',
      JSON.stringify({
        fran: '2026-10-28',
        bocker: {
          'bok-a': { foretag: 'Exempelbygdens bygdegårdsförening', fran: '2026-11-17' },
          'bok-b': { vakta: false },
        },
      }),
    );
    expect(vakt.bocker).toEqual({
      'bok-a': {
        foretag: 'Exempelbygdens bygdegårdsförening',
        fran: '2026-11-17',
        vakta: true,
      },
      'bok-b': { vakta: false },
    });
  });

  /*
   * Beslut AE: what kind of book it is comes from the book itself. A file
   * written before still says it, and is read without it rather than refused,
   * so that the watcher keeps running through the update.
   */
  it('leaves out the profile and method that older files carry', () => {
    const vakt = tolkaVaktkonfig(
      '/v.json',
      '{"fran": "2026-10-28", "profil": "forening", "redovisningsmetod": "kontantmetoden"}',
    );
    expect(vakt).not.toHaveProperty('profil');
    expect(vakt).not.toHaveProperty('redovisningsmetod');
  });

  it('refuses a start day for a book that is not a date', () => {
    expect(() =>
      tolkaVaktkonfig(
        '/v.json',
        '{"fran": "2026-10-28", "bocker": {"a": {"fran": "igår"}}}',
      ),
    ).toThrow('bocker.a.fran');
  });

  it('says what is wrong with the file', () => {
    expect(() => tolkaVaktkonfig('/v.json', '{"fran": "28 okt"}')).toThrow('ÅÅÅÅ-MM-DD');
    expect(() => tolkaVaktkonfig('/v.json', 'fran=x')).toThrow('inte giltig JSON');
  });
});
