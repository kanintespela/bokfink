import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { addDagar, datum, datumAv } from './datum';
import { arAllmanHelgdag, arVardag, fristdag, paskdagen, veckodag } from './helgdag';

describe('veckodag', () => {
  it('knows the weekday of known dates', () => {
    expect(veckodag(datum('1970-01-01'))).toBe(4);
    expect(veckodag(datum('2026-10-04'))).toBe(7);
    expect(veckodag(datum('2026-10-05'))).toBe(1);
    expect(veckodag(datum('1969-12-31'))).toBe(3);
    expect(veckodag(datum('2000-02-29'))).toBe(2);
  });

  it('steps by one every day', () => {
    fc.assert(
      fc.property(fc.integer({ min: -40_000, max: 40_000 }), (dagar) => {
        const dag = addDagar(datum('2026-01-01'), dagar);
        expect(veckodag(addDagar(dag, 1))).toBe((veckodag(dag) % 7) + 1);
      }),
    );
  });
});

describe('paskdagen', () => {
  it('matches the dates in the Swedish almanac', () => {
    expect(paskdagen(2019)).toBe('2019-04-21');
    expect(paskdagen(2024)).toBe('2024-03-31');
    expect(paskdagen(2025)).toBe('2025-04-20');
    expect(paskdagen(2026)).toBe('2026-04-05');
    expect(paskdagen(2027)).toBe('2027-03-28');
    expect(paskdagen(2038)).toBe('2038-04-25');
  });

  it('is always a Sunday between 22 March and 25 April', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1900, max: 2200 }), (ar) => {
        const pask = paskdagen(ar);
        expect(veckodag(pask)).toBe(7);
        expect(pask >= datumAv(ar, 3, 22) && pask <= datumAv(ar, 4, 25)).toBe(true);
      }),
    );
  });
});

describe('arAllmanHelgdag', () => {
  it('lists every allmän helgdag in 2026 that is not a Sunday', () => {
    const helgdagar: string[] = [];
    for (let dag = datum('2026-01-01'); dag <= '2026-12-31'; dag = addDagar(dag, 1)) {
      if (arAllmanHelgdag(dag) && veckodag(dag) !== 7) {
        helgdagar.push(dag);
      }
    }
    expect(helgdagar).toEqual([
      '2026-01-01', // nyårsdagen
      '2026-01-06', // trettondedag jul
      '2026-04-03', // långfredagen
      '2026-04-06', // annandag påsk
      '2026-05-01', // första maj
      '2026-05-14', // Kristi himmelsfärdsdag
      '2026-06-06', // nationaldagen, a helgdag even on a Saturday
      '2026-06-20', // midsommardagen
      '2026-10-31', // alla helgons dag
      '2026-12-25', // juldagen
      '2026-12-26', // annandag jul
    ]);
  });

  it('puts alla helgons dag in November when 31 October is not a Saturday', () => {
    expect(arAllmanHelgdag(datum('2025-11-01'))).toBe(true);
    expect(arAllmanHelgdag(datum('2027-11-06'))).toBe(true);
    expect(arAllmanHelgdag(datum('2027-10-30'))).toBe(false);
  });
});

describe('arVardag', () => {
  it('excludes the three aftnar that are not helgdagar', () => {
    expect(arVardag(datum('2026-06-19'))).toBe(false); // midsommarafton
    expect(arVardag(datum('2026-12-24'))).toBe(false);
    expect(arVardag(datum('2026-12-31'))).toBe(false);
    expect(arVardag(datum('2026-06-18'))).toBe(true);
  });

  it('excludes Saturdays and Sundays', () => {
    expect(arVardag(datum('2026-10-03'))).toBe(false);
    expect(arVardag(datum('2026-10-04'))).toBe(false);
    expect(arVardag(datum('2026-10-02'))).toBe(true);
  });
});

describe('fristdag', () => {
  it('keeps a deadline that falls on a vardag', () => {
    expect(fristdag(datum('2026-11-12'))).toBe('2026-11-12');
  });

  it('moves a deadline on a weekend to the Monday', () => {
    expect(fristdag(datum('2025-08-17'))).toBe('2025-08-18');
    expect(fristdag(datum('2024-08-17'))).toBe('2024-08-19');
  });

  it('moves past a run of non-vardagar', () => {
    // Julafton Thursday, juldagen, annandag jul, Sunday: next vardag is 28th.
    expect(fristdag(datum('2026-12-24'))).toBe('2026-12-28');
  });

  it('moves a deadline off Kristi himmelsfärdsdag', () => {
    expect(fristdag(datum('2026-05-14'))).toBe('2026-05-15');
  });
});
