import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import { kontonummer } from '../konto/konto';
import { datum, datumAv } from '../tid/datum';
import type { Uuid } from '../id/uuidv7';
import {
  arLast,
  datumForAnnullering,
  FramtidaDatumError,
  kontrolleraBokforingsbart,
  kontrolleraInteFramtida,
  omfattar,
  overlappar,
  PeriodLastError,
  rakenskapsarsid,
  skapaRakenskapsar,
  type Ingaendebalans,
} from './rakenskapsar';

const ID = '019b76da-a800-7000-8000-000000000000' as Uuid;

const ib = (konto: string, kronor: string): Ingaendebalans => ({
  konto: kontonummer(konto),
  belopp: oreFromKronor(kronor),
});

/**
 * Opening balances for 2026 in the shape a sole trader's SIE export has:
 * property and equipment with accumulated depreciation, stock, the bank,
 * the 20xx equity accounts and a VAT receivable. Made-up figures that sum
 * to zero, as every set of opening balances must.
 */
const IB_2026: Ingaendebalans[] = [
  ib('1110', '52000.00'),
  ib('1119', '-6240.00'),
  ib('1130', '150000.00'),
  ib('1220', '64000.00'),
  ib('1229', '-38400.00'),
  ib('1400', '5600.00'),
  ib('1930', '23817.45'),
  ib('2010', '-260882.70'),
  ib('2013', '-18250.30'),
  ib('2019', '26480.55'),
  ib('2650', '1875.00'),
];

const ar2026 = (extra: Partial<Parameters<typeof skapaRakenskapsar>[0]> = {}) =>
  skapaRakenskapsar({
    id: ID,
    start: datum('2026-01-01'),
    slut: datum('2026-12-31'),
    ingaendeBalanser: IB_2026,
    ...extra,
  });

describe('skapaRakenskapsar', () => {
  it('accepts a calendar year with a full set of opening balances', () => {
    const ar = ar2026();
    expect(ar.start).toBe('2026-01-01');
    expect(ar.slut).toBe('2026-12-31');
    expect(ar.avslutat).toBe(false);
    expect(ar.ingaendeBalanser).toHaveLength(11);
  });

  it('accepts a year with no opening balances at all', () => {
    const ar = skapaRakenskapsar({
      id: ID,
      start: datum('2023-01-01'),
      slut: datum('2023-12-31'),
    });
    expect(ar.ingaendeBalanser).toEqual([]);
  });

  it('refuses opening balances that do not sum to zero', () => {
    expect(() => ar2026({ ingaendeBalanser: [...IB_2026, ib('1930', '1.00')] })).toThrow(
      TypeError,
    );
  });

  it('refuses an opening balance on a result account', () => {
    // A result account starts every year at zero by definition.
    expect(() =>
      ar2026({ ingaendeBalanser: [ib('4010', '100.00'), ib('1930', '-100.00')] }),
    ).toThrow(TypeError);
  });

  it('refuses a year that ends before it starts', () => {
    expect(() =>
      skapaRakenskapsar({
        id: ID,
        start: datum('2026-12-31'),
        slut: datum('2026-01-01'),
      }),
    ).toThrow(TypeError);
  });

  it('allows up to eighteen months and no more', () => {
    // Bokföringslagen 3 kap. 3 §: a first or realigned year may run to
    // eighteen months, never further.
    expect(
      skapaRakenskapsar({
        id: ID,
        start: datum('2026-01-01'),
        slut: datum('2027-06-30'),
      }).slut,
    ).toBe('2027-06-30');

    expect(() =>
      skapaRakenskapsar({
        id: ID,
        start: datum('2026-01-01'),
        slut: datum('2027-07-01'),
      }),
    ).toThrow(RangeError);
  });

  it('refuses a VAT lock outside the year', () => {
    expect(() => ar2026({ momslastTom: datum('2025-12-31') })).toThrow(RangeError);
  });

  it('copies the balances so the caller cannot change them afterwards', () => {
    const balanser = [ib('1930', '100.00'), ib('2010', '-100.00')];
    const ar = ar2026({ ingaendeBalanser: balanser });
    balanser.push(ib('1930', '5.00'));
    expect(ar.ingaendeBalanser).toHaveLength(2);
  });
});

describe('omfattar and overlappar', () => {
  it('includes both end days', () => {
    const ar = ar2026();
    expect(omfattar(ar, datum('2026-01-01'))).toBe(true);
    expect(omfattar(ar, datum('2026-12-31'))).toBe(true);
    expect(omfattar(ar, datum('2025-12-31'))).toBe(false);
    expect(omfattar(ar, datum('2027-01-01'))).toBe(false);
  });

  it('finds consecutive years not to overlap', () => {
    const a = { start: datum('2025-01-01'), slut: datum('2025-12-31') };
    const b = { start: datum('2026-01-01'), slut: datum('2026-12-31') };
    expect(overlappar(a, b)).toBe(false);
    expect(overlappar(b, a)).toBe(false);
  });

  it('finds a single shared day to be an overlap', () => {
    const a = { start: datum('2025-01-01'), slut: datum('2026-01-01') };
    const b = { start: datum('2026-01-01'), slut: datum('2026-12-31') };
    expect(overlappar(a, b)).toBe(true);
  });
});

describe('period locking', () => {
  it('lets an open year take any day inside it', () => {
    const ar = ar2026();
    expect(arLast(ar, datum('2026-06-15'))).toBe(false);
    expect(() => kontrolleraBokforingsbart(ar, datum('2026-06-15'))).not.toThrow();
  });

  it('locks everything up to and including the VAT lock date', () => {
    // A sole trader's books lock quarter by quarter as each momsdeklaration is filed.
    const ar = ar2026({ momslastTom: datum('2026-03-31') });
    expect(arLast(ar, datum('2026-03-31'))).toBe(true);
    expect(arLast(ar, datum('2026-04-01'))).toBe(false);
    expect(() => kontrolleraBokforingsbart(ar, datum('2026-03-31'))).toThrow(
      PeriodLastError,
    );
    expect(() => kontrolleraBokforingsbart(ar, datum('2026-04-01'))).not.toThrow();
  });

  /*
   * The lock protects a filed momsdeklaration, and a verifikat that touches
   * no account the declaration reads cannot change it. The bokslut needs
   * exactly that: a periodisering or an avskrivning dated the year's last
   * day, after the fourth quarter has been filed and locked.
   */
  it('lets a verifikat that does not touch the momsdeklaration into a VAT-locked period', () => {
    const ar = ar2026({ momslastTom: datum('2026-12-31') });
    expect(() => kontrolleraBokforingsbart(ar, datum('2026-12-31'), false)).not.toThrow();
    expect(() => kontrolleraBokforingsbart(ar, datum('2026-12-31'), true)).toThrow(
      PeriodLastError,
    );
  });

  it('keeps a closed year shut even to a verifikat without moms', () => {
    const ar = ar2026({ avslutat: true });
    expect(() => kontrolleraBokforingsbart(ar, datum('2026-06-15'), false)).toThrow(
      PeriodLastError,
    );
  });

  it('locks a closed year completely', () => {
    const ar = ar2026({ avslutat: true });
    expect(arLast(ar, datum('2026-06-15'))).toBe(true);
    expect(() => kontrolleraBokforingsbart(ar, datum('2026-06-15'))).toThrow(
      PeriodLastError,
    );
  });

  it('refuses a day outside the year before it looks at any lock', () => {
    const ar = ar2026();
    expect(() => kontrolleraBokforingsbart(ar, datum('2025-12-31'))).toThrow(
      /utanför räkenskapsåret/,
    );
  });

  it('explains a VAT lock in terms of the filed return', () => {
    const ar = ar2026({ momslastTom: datum('2026-06-30') });
    expect(() => kontrolleraBokforingsbart(ar, datum('2026-05-01'))).toThrow(
      /momsdeklarationen/,
    );
  });

  it('never accepts a day it calls locked', () => {
    const ar = ar2026({ momslastTom: datum('2026-06-30') });
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (manad, dagIManaden) => {
          const dag = datumAv(2026, manad, dagIManaden);
          if (arLast(ar, dag)) {
            expect(() => kontrolleraBokforingsbart(ar, dag)).toThrow(PeriodLastError);
          } else {
            expect(() => kontrolleraBokforingsbart(ar, dag)).not.toThrow();
          }
        },
      ),
    );
  });
});

describe('kontrolleraInteFramtida', () => {
  it('lets today and earlier through', () => {
    expect(() =>
      kontrolleraInteFramtida(datum('2026-09-13'), datum('2026-09-13')),
    ).not.toThrow();
    expect(() =>
      kontrolleraInteFramtida(datum('2025-12-31'), datum('2026-09-13')),
    ).not.toThrow();
  });

  it('refuses tomorrow, by name', () => {
    expect(() =>
      kontrolleraInteFramtida(datum('2026-09-14'), datum('2026-09-13')),
    ).toThrow(FramtidaDatumError);
    expect(() =>
      kontrolleraInteFramtida(datum('2026-12-24'), datum('2026-04-05')),
    ).toThrow('2026-12-24');
  });
});

describe('datumForAnnullering', () => {
  const idag = datum('2026-09-05');

  /*
   * While the original's period is open, the reversal belongs there: the pair
   * nets to nothing inside the period and no figure already reported moves.
   */
  it('reverses inside the original period while it is open', () => {
    expect(datumForAnnullering(ar2026(), datum('2026-02-13'), idag)).toBe('2026-02-13');
  });

  /*
   * Once the momsdeklaration is filed the period cannot be booked into, so
   * the correction belongs where the mistake surfaced.
   */
  it('moves to today when the original period is VAT locked', () => {
    const ar = ar2026({ momslastTom: datum('2026-06-30') });
    expect(datumForAnnullering(ar, datum('2026-02-13'), idag)).toBe('2026-09-05');
  });

  it('has nowhere to put it when the whole year is closed', () => {
    const ar = ar2026({ avslutat: true });
    expect(datumForAnnullering(ar, datum('2026-02-13'), idag)).toBeUndefined();
  });

  it('has nowhere to put it when today is itself locked', () => {
    const ar = ar2026({ momslastTom: datum('2026-12-31') });
    expect(datumForAnnullering(ar, datum('2026-02-13'), idag)).toBeUndefined();
  });

  it('refuses a date the year does not cover', () => {
    expect(datumForAnnullering(ar2026(), datum('2025-02-13'), idag)).toBe('2026-09-05');
  });
});

describe('rakenskapsarsid', () => {
  /*
   * The whole point: two devices that each decide to create "the year that
   * covers today" must arrive at the same identifier, or the logs merge into
   * two years where there should be one.
   */
  it('gives the same identifier for the same start date', () => {
    expect(rakenskapsarsid(datum('2026-01-01'))).toBe(
      rakenskapsarsid(datum('2026-01-01')),
    );
  });

  it('gives different identifiers for different years', () => {
    expect(rakenskapsarsid(datum('2026-01-01'))).not.toBe(
      rakenskapsarsid(datum('2025-01-01')),
    );
    // A broken fiscal year starting in the same year is still its own book.
    expect(rakenskapsarsid(datum('2026-07-01'))).not.toBe(
      rakenskapsarsid(datum('2026-01-01')),
    );
  });

  it('is a UUID', () => {
    expect(rakenskapsarsid(datum('2026-01-01'))).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
