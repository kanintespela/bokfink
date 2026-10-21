import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { granskaSerie, nastaVerifikationsnummer, verifikatserie } from './serie';

describe('verifikatserie', () => {
  it('accepts the labels real books use', () => {
    // A real export can run series V for part of a year and A after.
    expect(verifikatserie('A')).toBe('A');
    expect(verifikatserie('V')).toBe('V');
    expect(verifikatserie('b')).toBe('B');
    expect(verifikatserie(' a ')).toBe('A');
  });

  it('rejects labels that are not one', () => {
    for (const bad of ['', '  ', 'ABCDE', 'A-1', 'A B', 'a.b']) {
      expect(() => verifikatserie(bad)).toThrow(TypeError);
    }
  });
});

describe('nastaVerifikationsnummer', () => {
  it('starts a fresh series at one', () => {
    expect(nastaVerifikationsnummer(undefined)).toBe(1);
  });

  it('continues from the highest number handed out', () => {
    expect(nastaVerifikationsnummer(1)).toBe(2);
    expect(nastaVerifikationsnummer(61)).toBe(62);
  });

  it('never repeats a number over a long run', () => {
    const utdelade: number[] = [];
    let hogsta: number | undefined;
    for (let i = 0; i < 500; i += 1) {
      hogsta = nastaVerifikationsnummer(hogsta);
      utdelade.push(hogsta);
    }
    expect(new Set(utdelade).size).toBe(500);
    expect(granskaSerie(utdelade).obruten).toBe(true);
  });

  it('refuses a highest-used that is not a positive whole number', () => {
    expect(() => nastaVerifikationsnummer(0)).toThrow(TypeError);
    expect(() => nastaVerifikationsnummer(-1)).toThrow(TypeError);
    expect(() => nastaVerifikationsnummer(1.5)).toThrow(TypeError);
  });
});

describe('granskaSerie', () => {
  it('calls an empty series unbroken', () => {
    expect(granskaSerie([])).toEqual({ luckor: [], dubbletter: [], obruten: true });
  });

  it('accepts the real series from the export', () => {
    // 2023 ran A 1..23 alongside V 1..35, both unbroken.
    const a = Array.from({ length: 23 }, (_, i) => i + 1);
    const v = Array.from({ length: 35 }, (_, i) => i + 1);
    expect(granskaSerie(a).obruten).toBe(true);
    expect(granskaSerie(v).obruten).toBe(true);
  });

  it('ignores the order the numbers arrive in', () => {
    expect(granskaSerie([3, 1, 2]).obruten).toBe(true);
  });

  it('finds a missing number', () => {
    expect(granskaSerie([1, 2, 4])).toEqual({
      luckor: [3],
      dubbletter: [],
      obruten: false,
    });
  });

  it('treats a series that does not start at one as having a gap', () => {
    // A run beginning at 5 means four numbers were issued and lost, or the
    // series was renumbered. Both break hard rule 6.
    expect(granskaSerie([5, 6]).luckor).toEqual([1, 2, 3, 4]);
  });

  it('finds a reused number', () => {
    expect(granskaSerie([1, 2, 2, 3])).toEqual({
      luckor: [],
      dubbletter: [2],
      obruten: false,
    });
  });

  it('calls any complete run from one unbroken', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), (antal) => {
        const nummer = Array.from({ length: antal }, (_, i) => i + 1);
        expect(granskaSerie(nummer).obruten).toBe(true);
      }),
    );
  });

  it('spots any single number removed from a complete run', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 100 }),
        fc.integer({ min: 1, max: 100 }),
        (antal, rawSaknad) => {
          const saknad = ((rawSaknad - 1) % antal) + 1;
          const nummer = Array.from({ length: antal }, (_, i) => i + 1).filter(
            (n) => n !== saknad,
          );
          const granskning = granskaSerie(nummer);
          if (saknad === antal) {
            // Removing the last number shortens the run rather than holing it.
            expect(granskning.obruten).toBe(true);
          } else {
            expect(granskning.luckor).toEqual([saknad]);
          }
        },
      ),
    );
  });
});
