import { describe, expect, it } from 'vitest';

import {
  BOKPROFILER,
  BOKPROFILNAMN,
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
