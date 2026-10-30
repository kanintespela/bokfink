import { describe, expect, it } from 'vitest';

import {
  arMomsregistrerad,
  BOKPROFILER,
  BOKPROFILNAMN,
  harFunktion,
  STANDARD_BOKPROFIL,
  tolkaBokprofil,
} from './bokprofil';

describe('tolkaBokprofil', () => {
  it('reads every profile the app knows', () => {
    for (const profil of BOKPROFILER) {
      expect(tolkaBokprofil(profil)).toBe(profil);
    }
  });

  it('takes a book with no stored profile for an enskild firma', () => {
    expect(STANDARD_BOKPROFIL).toBe('enskild_firma');
    expect(tolkaBokprofil(undefined)).toBe('enskild_firma');
  });

  it('refuses a profile it does not know instead of guessing', () => {
    expect(() => tolkaBokprofil('stiftelse')).toThrow(/inte känner till: stiftelse/);
    expect(() => tolkaBokprofil(null)).toThrow(TypeError);
    expect(() => tolkaBokprofil('')).toThrow(TypeError);
  });

  it('has a name to show for each profile', () => {
    expect(BOKPROFILER.map((profil) => BOKPROFILNAMN[profil])).toEqual([
      'Enskild firma',
      'Ideell förening',
    ]);
  });
});

describe('harFunktion', () => {
  it('gives an enskild firma everything that belongs to its owner', () => {
    for (const funktion of [
      'nebilaga',
      'egnaUttag',
      'djurlager',
      'k1Bokslut',
      'inkomstdeklarationsdag',
    ] as const) {
      expect(harFunktion('enskild_firma', funktion)).toBe(true);
    }
  });

  it("gives an association none of the owner's features", () => {
    for (const funktion of [
      'nebilaga',
      'egnaUttag',
      'djurlager',
      'k1Bokslut',
      'inkomstdeklarationsdag',
    ] as const) {
      expect(harFunktion('forening', funktion)).toBe(false);
    }
  });
});

describe('foreningens eget kapital', () => {
  it('belongs to an association and not to a firm', () => {
    expect(harFunktion('forening', 'foreningskapital')).toBe(true);
    expect(harFunktion('enskild_firma', 'foreningskapital')).toBe(false);
  });

  it("has a year-end statement of its own, which a firm's K1 is not", () => {
    expect(harFunktion('forening', 'foreningsbokslut')).toBe(true);
    expect(harFunktion('enskild_firma', 'foreningsbokslut')).toBe(false);
    expect(harFunktion('forening', 'k1Bokslut')).toBe(false);
  });
});

describe('arMomsregistrerad', () => {
  it('takes a firm to be registered whatever was said', () => {
    expect(arMomsregistrerad('enskild_firma', undefined)).toBe(true);
    expect(arMomsregistrerad('enskild_firma', false)).toBe(true);
  });

  it('takes an association not to be until it is said so', () => {
    expect(arMomsregistrerad('forening', undefined)).toBe(false);
    expect(arMomsregistrerad('forening', false)).toBe(false);
    expect(arMomsregistrerad('forening', true)).toBe(true);
  });
});
