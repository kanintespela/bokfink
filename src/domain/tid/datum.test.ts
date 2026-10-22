import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  addDagar,
  ar,
  arSkottar,
  dagarMellan,
  datum,
  datumAv,
  delar,
  forsta,
  forstaIAret,
  forstaIManaden,
  inomIntervall,
  jamfor,
  sistaIAret,
  sistaIManaden,
} from './datum';
import { fastKlocka } from './klocka';

/** Dates across the range a set of books plausibly spans. */
/*
 * Built from parts rather than from fc.date, for two reasons. `new Date` is
 * banned in this layer and the rule is right to catch it even here: an
 * exemption for tests is exactly how a real clock reading gets in later. And
 * generating years, months and days directly puts month ends and leap days in
 * the sample far more often than a uniform spread over milliseconds would.
 *
 * The day is clamped by arSkottar, which has its own tests against known
 * years further down, so this is not the implementation checking itself.
 */
function dagarIManaden(year: number, month: number): number {
  if (month === 2) {
    return arSkottar(year) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

const arbDatum = fc
  .tuple(
    fc.integer({ min: 1990, max: 2100 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 31 }),
  )
  .map(([y, m, d]) => datumAv(y, m, Math.min(d, dagarIManaden(y, m))));

describe('datum', () => {
  it('accepts the dates in a real SIE export', () => {
    expect(datum('2026-01-01')).toBe('2026-01-01');
    expect(datum('2023-09-26')).toBe('2023-09-26');
    expect(datum('2025-12-31')).toBe('2025-12-31');
  });

  it('accepts 29 February in a leap year and rejects it otherwise', () => {
    expect(datum('2024-02-29')).toBe('2024-02-29');
    expect(() => datum('2025-02-29')).toThrow(RangeError);
    // 2100 is divisible by 4 but not a leap year.
    expect(() => datum('2100-02-29')).toThrow(RangeError);
    expect(datum('2000-02-29')).toBe('2000-02-29');
  });

  it('rejects days the calendar does not have', () => {
    for (const bad of ['2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10']) {
      expect(() => datum(bad)).toThrow(RangeError);
    }
  });

  it('rejects anything that is not ÅÅÅÅ-MM-DD', () => {
    for (const bad of ['', '2026-1-1', '20260101', '2026/01/01', 'igår', '2026-01-01 ']) {
      expect(() => datum(bad)).toThrow(TypeError);
    }
  });

  it('splits into parts and back', () => {
    fc.assert(
      fc.property(arbDatum, (value) => {
        const { ar: y, manad: m, dag: d } = delar(value);
        expect(datumAv(y, m, d)).toBe(value);
      }),
    );
  });
});

describe('ordering', () => {
  it('sorts as a string exactly as it sorts in time', () => {
    fc.assert(
      fc.property(arbDatum, arbDatum, (a, b) => {
        /*
         * The two run opposite ways by convention, and deliberately so:
         * jamfor is a comparator, negative when `a` comes first, while
         * dagarMellan measures forwards from `a` and is positive when `b`
         * is later. What matters is that they never disagree about order.
         */
        expect(jamfor(a, b) < 0).toBe(dagarMellan(a, b) > 0);
        expect(jamfor(a, b) === 0).toBe(dagarMellan(a, b) === 0);
        expect(jamfor(a, b) > 0).toBe(dagarMellan(a, b) < 0);
      }),
    );
  });

  it('picks the earliest of several dates', () => {
    expect(forsta(datum('2026-03-01'), datum('2025-12-31'), datum('2026-01-01'))).toBe(
      '2025-12-31',
    );
    expect(forsta()).toBeUndefined();
  });

  it('treats an interval as closed at both ends', () => {
    const from = datum('2026-01-01');
    const to = datum('2026-12-31');
    expect(inomIntervall(from, from, to)).toBe(true);
    expect(inomIntervall(to, from, to)).toBe(true);
    expect(inomIntervall(datum('2025-12-31'), from, to)).toBe(false);
    expect(inomIntervall(datum('2027-01-01'), from, to)).toBe(false);
  });
});

describe('day arithmetic', () => {
  it('steps across a month boundary', () => {
    expect(addDagar(datum('2026-01-31'), 1)).toBe('2026-02-01');
    expect(addDagar(datum('2026-03-01'), -1)).toBe('2026-02-28');
  });

  it('steps across a leap day', () => {
    expect(addDagar(datum('2024-02-28'), 1)).toBe('2024-02-29');
    expect(addDagar(datum('2024-02-29'), 1)).toBe('2024-03-01');
    expect(dagarMellan(datum('2024-01-01'), datum('2025-01-01'))).toBe(366);
    expect(dagarMellan(datum('2025-01-01'), datum('2026-01-01'))).toBe(365);
  });

  it('steps across a year boundary, which is where a fiscal year turns', () => {
    expect(addDagar(datum('2025-12-31'), 1)).toBe('2026-01-01');
    expect(addDagar(datum('2026-01-01'), -1)).toBe('2025-12-31');
  });

  /*
   * Sweden moves the clock on the last Sunday in March and October. A
   * date-only value must not notice: adding a day over either must give the
   * next day, not the same one or the one after.
   */
  it('is unaffected by daylight saving', () => {
    expect(addDagar(datum('2026-03-28'), 1)).toBe('2026-03-29');
    expect(addDagar(datum('2026-03-29'), 1)).toBe('2026-03-30');
    expect(addDagar(datum('2026-10-24'), 1)).toBe('2026-10-25');
    expect(addDagar(datum('2026-10-25'), 1)).toBe('2026-10-26');
    expect(dagarMellan(datum('2026-03-28'), datum('2026-03-30'))).toBe(2);
    expect(dagarMellan(datum('2026-10-24'), datum('2026-10-26'))).toBe(2);
  });

  it('returns to where it started', () => {
    fc.assert(
      fc.property(arbDatum, fc.integer({ min: -20_000, max: 20_000 }), (value, days) => {
        expect(addDagar(addDagar(value, days), -days)).toBe(value);
      }),
    );
  });

  it('agrees with dagarMellan in both directions', () => {
    fc.assert(
      fc.property(arbDatum, fc.integer({ min: -20_000, max: 20_000 }), (value, days) => {
        expect(dagarMellan(value, addDagar(value, days))).toBe(days);
      }),
    );
  });

  it('advances exactly one day at a time over a long run', () => {
    let value = datum('2023-12-28');
    for (let i = 0; i < 800; i += 1) {
      const next = addDagar(value, 1);
      expect(dagarMellan(value, next)).toBe(1);
      value = next;
    }
    expect(value).toBe('2026-03-07');
  });

  it('refuses a fractional number of days', () => {
    expect(() => addDagar(datum('2026-01-01'), 1.5)).toThrow(TypeError);
  });
});

describe('period boundaries', () => {
  it('finds the ends of a month', () => {
    expect(forstaIManaden(datum('2026-09-04'))).toBe('2026-09-01');
    expect(sistaIManaden(datum('2026-09-04'))).toBe('2026-09-30');
    expect(sistaIManaden(datum('2026-02-10'))).toBe('2026-02-28');
    expect(sistaIManaden(datum('2024-02-10'))).toBe('2024-02-29');
  });

  it('finds the ends of a calendar year, which is the fiscal year here', () => {
    expect(forstaIAret(datum('2026-09-04'))).toBe('2026-01-01');
    expect(sistaIAret(datum('2026-09-04'))).toBe('2026-12-31');
    expect(ar(datum('2026-09-04'))).toBe(2026);
  });

  it('always lands inside the month it was given', () => {
    fc.assert(
      fc.property(arbDatum, (value) => {
        const first = forstaIManaden(value);
        const last = sistaIManaden(value);
        expect(inomIntervall(value, first, last)).toBe(true);
        expect(delar(first).dag).toBe(1);
        expect(dagarMellan(last, addDagar(last, 1))).toBe(1);
        expect(delar(addDagar(last, 1)).dag).toBe(1);
      }),
    );
  });
});

describe('arSkottar', () => {
  it('follows the Gregorian rule', () => {
    expect([2024, 2000, 1996].map(arSkottar)).toEqual([true, true, true]);
    expect([2025, 2026, 1900, 2100].map(arSkottar)).toEqual([false, false, false, false]);
  });
});

describe('fastKlocka', () => {
  it('keeps giving the same day', () => {
    const klocka = fastKlocka(datum('2026-09-04'));
    expect(klocka.idag()).toBe('2026-09-04');
    expect(klocka.idag()).toBe('2026-09-04');
  });
});
