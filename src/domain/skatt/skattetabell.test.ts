import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import {
  forhojtPrisbasbelopp,
  halvtPrisbasbelopp,
  kontrolleraPrisbasbelopp,
  OkantSkattearError,
  prisbasbelopp,
} from './skattetabell';

describe('prisbasbelopp', () => {
  // Verified one by one against regeringen.se's own "fastställt"
  // announcements, not extrapolated from a trend.
  it.each([
    ['2023', 52_500],
    ['2024', 57_300],
    ['2025', 58_800],
    ['2026', 59_200],
  ])('is %s kr for %s', (ar, kronor) => {
    expect(prisbasbelopp(Number(ar))).toBe(oreFromKronor(String(kronor)));
  });

  it('refuses a year that has not been entered rather than guessing', () => {
    expect(() => prisbasbelopp(2027)).toThrow(OkantSkattearError);
    expect(() => prisbasbelopp(2022)).toThrow(OkantSkattearError);
  });
});

describe('forhojtPrisbasbelopp', () => {
  it('is 60 000 kr for 2025', () => {
    expect(forhojtPrisbasbelopp(2025)).toBe(oreFromKronor('60000'));
  });
});

describe('halvtPrisbasbelopp', () => {
  it('is exactly half for 2025', () => {
    expect(halvtPrisbasbelopp(2025)).toBe(oreFromKronor('29400'));
  });

  it('is exactly half for 2023', () => {
    expect(halvtPrisbasbelopp(2023)).toBe(oreFromKronor('26250'));
  });
});

/*
 * A year Kontera ships without can be added by the owner - fetched from SCB
 * or typed in - rather than waiting for a new version of the app. The table
 * in the code still wins where it has the year: those figures are checked
 * against regeringen's decision one by one.
 */
describe('prisbasbelopp entered by the owner', () => {
  const egna = new Map([[2027, oreFromKronor('59600')]]);

  it('is used for a year the table does not have', () => {
    expect(prisbasbelopp(2027, egna)).toBe(oreFromKronor('59600'));
    expect(halvtPrisbasbelopp(2027, egna)).toBe(oreFromKronor('29800'));
  });

  it('never overrides a year the table has', () => {
    expect(prisbasbelopp(2026, new Map([[2026, oreFromKronor('1000')]]))).toBe(
      oreFromKronor('59200'),
    );
  });

  it('accepts only a whole hundred of kronor, which is how it is set', () => {
    expect(() => kontrolleraPrisbasbelopp(oreFromKronor('59600'))).not.toThrow();
    expect(() => kontrolleraPrisbasbelopp(oreFromKronor('59650'))).toThrow('hundratal');
    expect(() => kontrolleraPrisbasbelopp(oreFromKronor('0'))).toThrow('hundratal');
  });
});
