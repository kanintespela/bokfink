import { describe, expect, it } from 'vitest';

import { datum } from '../tid/datum';
import { periodFor, perioder } from './period';

const ar = { fran: datum('2026-01-01'), till: datum('2026-12-31') };

describe('perioder', () => {
  it('splits a year into quarters that meet without overlapping', () => {
    const kvartal = perioder(ar.fran, ar.till, 'kvartal');

    expect(kvartal.map((period) => [period.namn, period.fran, period.till])).toEqual([
      ['2026 kv 1', '2026-01-01', '2026-03-31'],
      ['2026 kv 2', '2026-04-01', '2026-06-30'],
      ['2026 kv 3', '2026-07-01', '2026-09-30'],
      ['2026 kv 4', '2026-10-01', '2026-12-31'],
    ]);
  });

  it('splits a year into twelve months', () => {
    const manader = perioder(ar.fran, ar.till, 'manad');
    expect(manader).toHaveLength(12);
    expect(manader[1]).toEqual({
      namn: '2026-02',
      fran: '2026-02-01',
      till: '2026-02-28',
    });
  });

  it('gets February right in a leap year', () => {
    const manader = perioder(datum('2024-01-01'), datum('2024-12-31'), 'manad');
    expect(manader[1]?.till).toBe('2024-02-29');
  });

  it('leaves a yearly period whole', () => {
    expect(perioder(ar.fran, ar.till, 'ar')).toEqual([
      { namn: '2026', fran: '2026-01-01', till: '2026-12-31' },
    ]);
  });

  it('covers every day of the year exactly once', () => {
    for (const langd of ['manad', 'kvartal', 'ar'] as const) {
      const alla = perioder(ar.fran, ar.till, langd);
      expect(alla[0]?.fran).toBe('2026-01-01');
      expect(alla.at(-1)?.till).toBe('2026-12-31');

      for (const [forra, nasta] of alla.slice(0, -1).map((p, i) => [p, alla[i + 1]!])) {
        // No gap and no overlap: each period starts the day after the last ends.
        expect(nasta!.fran > forra!.till).toBe(true);
      }
    }
  });
});

describe('periodFor', () => {
  it('finds the period a date falls in', () => {
    const kvartal = perioder(ar.fran, ar.till, 'kvartal');
    expect(periodFor(kvartal, datum('2026-02-13'))?.namn).toBe('2026 kv 1');
    expect(periodFor(kvartal, datum('2026-03-31'))?.namn).toBe('2026 kv 1');
    expect(periodFor(kvartal, datum('2026-04-01'))?.namn).toBe('2026 kv 2');
    expect(periodFor(kvartal, datum('2025-12-31'))).toBeUndefined();
  });
});
