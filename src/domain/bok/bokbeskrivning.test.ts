import { describe, expect, it } from 'vitest';

import {
  OlasligBokbeskrivningError,
  skrivBokbeskrivning,
  tolkaBokbeskrivning,
  type Bokbeskrivning,
} from './bokbeskrivning';

describe('bokbeskrivning', () => {
  const forening: Bokbeskrivning = {
    namn: 'Bygdegårdsföreningen',
    profil: 'forening',
    momsperiod: 'ar',
    momsregistrerad: false,
    redovisningsmetod: 'faktureringsmetoden',
  };

  it('comes back as it was written', () => {
    expect(tolkaBokbeskrivning(skrivBokbeskrivning(forening))).toEqual(forening);
  });

  it('leaves out what the book has not chosen, rather than writing a default', () => {
    const text = skrivBokbeskrivning({ namn: 'Firman', profil: 'enskild_firma' });

    expect(text).toBe('{"namn":"Firman","profil":"enskild_firma"}');
    expect(tolkaBokbeskrivning(text)).toEqual({
      namn: 'Firman',
      profil: 'enskild_firma',
    });
  });

  /*
   * A device decides whether to tell the server again by comparing what it
   * would send with what it last sent, so the order the fields were set in
   * must not show.
   */
  it('writes the same text whatever order the fields were given in', () => {
    const omvand: Bokbeskrivning = {
      redovisningsmetod: 'faktureringsmetoden',
      momsregistrerad: false,
      momsperiod: 'ar',
      profil: 'forening',
      namn: 'Bygdegårdsföreningen',
    };

    expect(skrivBokbeskrivning(omvand)).toBe(skrivBokbeskrivning(forening));
  });

  it('keeps a false momsregistrerad, which is an answer and not a blank', () => {
    expect(tolkaBokbeskrivning(skrivBokbeskrivning(forening)).momsregistrerad).toBe(
      false,
    );
  });

  it.each([
    ['not JSON at all', 'AAAA.BBBB'],
    ['a list', '[]'],
    ['nothing', 'null'],
    ['no name', '{"profil":"forening"}'],
    ['a blank name', '{"namn":"  ","profil":"forening"}'],
    ['no profile', '{"namn":"Firman"}'],
  ])('refuses %s', (_vad, text) => {
    expect(() => tolkaBokbeskrivning(text)).toThrow(OlasligBokbeskrivningError);
  });

  /*
   * Dropping what is not understood would open the book as something it is
   * not. A newer app may know a third profile or a third method; this one
   * says so instead of guessing.
   */
  it.each([
    ['profile', '{"namn":"X","profil":"aktiebolag"}', 'profil "aktiebolag"'],
    [
      'method',
      '{"namn":"X","profil":"forening","redovisningsmetod":"bokslutsmetoden"}',
      'redovisningsmetod "bokslutsmetoden"',
    ],
    [
      'period',
      '{"namn":"X","profil":"forening","momsperiod":"vecka"}',
      'momsperiod "vecka"',
    ],
    ['trade', '{"namn":"X","profil":"enskild_firma","bransch":"rymd"}', 'bransch "rymd"'],
  ])('refuses a %s it does not know, and says which', (_vad, text, del) => {
    expect(() => tolkaBokbeskrivning(text)).toThrow(del);
  });

  it('refuses a momsregistrerad that is not yes or no', () => {
    expect(() =>
      tolkaBokbeskrivning('{"namn":"X","profil":"forening","momsregistrerad":"ja"}'),
    ).toThrow(OlasligBokbeskrivningError);
  });

  it('trims the name', () => {
    expect(tolkaBokbeskrivning('{"namn":" Firman ","profil":"enskild_firma"}').namn).toBe(
      'Firman',
    );
  });
});
