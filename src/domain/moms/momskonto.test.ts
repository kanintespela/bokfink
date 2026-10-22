import { describe, expect, it } from 'vitest';

import { forvaltMomskonto } from './momskonto';

describe('forvaltMomskonto', () => {
  it('suggests the BAS K1 account for the direction and rate', () => {
    expect(forvaltMomskonto('utgift', 25)).toBe('2641');
    expect(forvaltMomskonto('utgift', 12)).toBe('2641');
    expect(forvaltMomskonto('utgift', 6)).toBe('2641');
    expect(forvaltMomskonto('inkomst', 25)).toBe('2611');
    expect(forvaltMomskonto('inkomst', 12)).toBe('2621');
    expect(forvaltMomskonto('inkomst', 6)).toBe('2631');
  });

  it('suggests nothing for a booking without moms', () => {
    expect(forvaltMomskonto('inkomst', 0)).toBeUndefined();
    expect(forvaltMomskonto('utgift', 0)).toBeUndefined();
  });
});
