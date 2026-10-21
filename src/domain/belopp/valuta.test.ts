import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ore, oreFromKronor } from './ore';
import {
  kurs,
  kursAv,
  kursdifferens,
  kursText,
  tillRedovisningsvaluta,
  valutakod,
} from './valuta';

const kr = (text: string) => oreFromKronor(text);

/** A whole number of millionths written the way a rate is written. */
const somKurstext = (millionthar: number) =>
  `${Math.floor(millionthar / 1_000_000)},${String(millionthar % 1_000_000).padStart(6, '0')}`;

describe('valutakod', () => {
  it('accepts a three letter code and normalises it', () => {
    expect(valutakod('eur')).toBe('EUR');
    expect(valutakod(' usd ')).toBe('USD');
  });

  it('refuses anything else', () => {
    for (const trasig of ['', 'EU', 'EURO', 'E1R', 'kr']) {
      expect(() => valutakod(trasig)).toThrow(TypeError);
    }
  });
});

describe('kurs', () => {
  it('reads a rate as it is written', () => {
    expect(kursText(kurs('11,4523'))).toBe('11,4523');
    expect(kursText(kurs('11.4523'))).toBe('11,4523');
    expect(kursText(kurs('10'))).toBe('10');
  });

  it('keeps six decimals, which covers the currencies that need them', () => {
    expect(kursText(kurs('0,072345'))).toBe('0,072345');
  });

  it('refuses a rate that is not one', () => {
    for (const trasig of ['', 'elva', '-11,45', '0', '11,4523456']) {
      expect(() => kurs(trasig)).toThrow();
    }
  });
});

describe('tillRedovisningsvaluta', () => {
  /*
   * Worked by hand: 49,00 EUR at 11,4523 is 561,16270 kronor, which rounds to
   * 561,16. The rounding is to the nearest öre, halves away from zero - the
   * same rule the VAT split uses, so two roads to one figure agree.
   */
  it('converts an amount at a rate', () => {
    expect(tillRedovisningsvaluta(kr('49.00'), kurs('11,4523'))).toBe(kr('561.16'));
  });

  it('rounds a half away from zero', () => {
    // 1,00 at 1,005 is 1,005 kronor exactly: half an öre, rounded up.
    expect(tillRedovisningsvaluta(kr('1.00'), kurs('1,005'))).toBe(kr('1.01'));
    expect(tillRedovisningsvaluta(kr('-1.00'), kurs('1,005'))).toBe(kr('-1.01'));
  });

  it('keeps a credit a credit', () => {
    expect(tillRedovisningsvaluta(kr('-49.00'), kurs('11,4523'))).toBe(kr('-561.16'));
  });

  it('leaves zero alone', () => {
    expect(tillRedovisningsvaluta(kr('0'), kurs('11,4523'))).toBe(0);
  });

  /*
   * The reason the multiplication is done in BigInt, with a case that proves
   * it. 86 549 782,98 in a foreign currency at 65,339577 is exactly
   * 5 655 126 209,35244... kronor, so 5 655 126 209,35. In floating point the
   * same product comes out a hundredth higher: the multiplication passes 2^53
   * and the last digits are lost, which is a whole öre of somebody's money.
   */
  it('is exact where a float is not', () => {
    const belopp = kr('86549782.98');
    const vaxelkurs = kurs('65,339577');

    expect(tillRedovisningsvaluta(belopp, vaxelkurs)).toBe(565_512_620_935);
    expect(Math.round(belopp * (65_339_577 / 1_000_000))).toBe(565_512_620_936);
  });

  /*
   * Converting the parts and converting the whole may differ, but only ever
   * by the öre the rounding itself introduces. Anything larger would mean a
   * receipt's lines stopped adding up to its total.
   */
  it('splits within an öre of converting the whole', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100_000_000, max: 100_000_000 }),
        fc.integer({ min: -100_000_000, max: 100_000_000 }),
        fc.integer({ min: 1, max: 100_000_000 }),
        (a, b, millionthar) => {
          const vaxelkurs = kurs(somKurstext(millionthar));
          const delar =
            tillRedovisningsvaluta(ore(a), vaxelkurs) +
            tillRedovisningsvaluta(ore(b), vaxelkurs);
          const helhet = tillRedovisningsvaluta(ore(a + b), vaxelkurs);
          expect(Math.abs(delar - helhet)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe('kursAv', () => {
  it('reads the rate off both sides of a card purchase', () => {
    // 49,00 EUR became 561,20 SEK, so the bank charged 11,453061 per euro.
    expect(kursText(kursAv(kr('49.00'), kr('561.20')))).toBe('11,453061');
  });

  it('refuses to divide by nothing', () => {
    expect(() => kursAv(kr('0'), kr('100'))).toThrow(RangeError);
  });
});

describe('kursdifferens', () => {
  it('is a gain when more came in than the books said', () => {
    expect(kursdifferens(kr('561.16'), kr('570.00'))).toBe(kr('8.84'));
  });

  it('is a loss the other way', () => {
    expect(kursdifferens(kr('561.16'), kr('550.00'))).toBe(kr('-11.16'));
  });

  it('is nothing when nothing moved, which is the kontantmetod case', () => {
    expect(kursdifferens(kr('561.16'), kr('561.16'))).toBe(0);
  });
});
