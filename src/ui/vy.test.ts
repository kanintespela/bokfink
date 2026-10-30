import { describe, expect, it } from 'vitest';

import { doldaVyer, VYER } from './vy';

describe('doldaVyer', () => {
  it('shows an enskild firma everything', () => {
    expect([...doldaVyer('enskild_firma', true)]).toEqual([]);
  });

  it('hides what belongs to an owner, and moms, from an association without moms', () => {
    expect([...doldaVyer('forening', false)].sort()).toEqual(
      ['arsbokslut', 'egetkapital', 'lager', 'moms', 'nebilaga'].sort(),
    );
  });

  it('gives a registered association its moms view back and nothing else', () => {
    const dolda = doldaVyer('forening', true);
    expect(dolda.has('moms')).toBe(false);
    expect(dolda.has('nebilaga')).toBe(true);
  });

  it('never hides the tabs along the bottom', () => {
    const dolda = doldaVyer('forening', false);
    for (const flik of ['attgora', 'kvitton', 'bokfor', 'verifikat', 'mer'] as const) {
      expect(dolda.has(flik)).toBe(false);
    }
    expect(VYER.length).toBeGreaterThan(dolda.size);
  });
});
