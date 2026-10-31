import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { oreFromKronor, sum, ZERO } from '../belopp/ore';
import { uuidv7 } from '../id/uuidv7';
import { datum } from '../tid/datum';
import { avyttra, skapaAnlaggningstillgang } from './anlaggningstillgang';
import { linjarAvskrivningForAr, linjaraAvskrivningar } from './linjaravskrivning';

const kr = oreFromKronor;
let raknare = 0;
const tillgang = (varde: string, anskaffad: string, ar = 5) =>
  skapaAnlaggningstillgang({
    id: uuidv7(1_788_554_000_000 + (raknare += 1), new Uint8Array(10).fill(2)),
    benamning: 'Ljudanläggning',
    anskaffningsdatum: datum(anskaffad),
    anskaffningsvarde: kr(varde),
    nyttjandeperiod: ar,
  });

describe('linjarAvskrivningForAr', () => {
  /*
   * 10 000 kr over five years, bought in March 2024: 2 000 kr a year in 2024-2028,
   * a full year's amount in the year it was bought (punkt 6.35), nothing before or after.
   */
  it('writes off the same amount each of the years, the first one included', () => {
    const a = tillgang('10000', '2024-03-15');
    expect(
      [2023, 2024, 2025, 2026, 2027, 2028, 2029].map((ar) =>
        linjarAvskrivningForAr(a, ar),
      ),
    ).toEqual([ZERO, kr('2000'), kr('2000'), kr('2000'), kr('2000'), kr('2000'), ZERO]);
  });

  /*
   * 1 000 kr over three years does not divide into whole öre. Rounded on the
   * running total: after one year 100 000/3 = 33 333,3 -> 33 333 öre; after two
   * 200 000/3 = 66 666,7 -> 66 667; after three 100 000. The years are the
   * differences: 333,33, 333,34 and 333,33, which add up to 1 000,00.
   */
  it('rounds on the running total, so the years add up to the acquisition value', () => {
    const a = tillgang('1000', '2025-06-01', 3);
    const ar = [2025, 2026, 2027].map((aret) => linjarAvskrivningForAr(a, aret));
    expect(ar).toEqual([kr('333.33'), kr('333.34'), kr('333.33')]);
    expect(sum(ar)).toBe(kr('1000'));
  });

  it('never goes negative for a small amount over many years', () => {
    // 13 öre over 20 years: each year's own rounding would be 1 öre, 20 of them.
    const a = tillgang('0.13', '2024-01-01', 20);
    const alla = Array.from({ length: 20 }, (_, i) =>
      linjarAvskrivningForAr(a, 2024 + i),
    );
    expect(alla.every((belopp) => belopp >= ZERO)).toBe(true);
    expect(sum(alla)).toBe(kr('0.13'));
  });

  it('writes nothing off in the year of a sale or a scrapping, nor after it', () => {
    const salt = avyttra(tillgang('10000', '2024-03-15'), {
      datum: datum('2026-05-01'),
      typ: 'forsaljning',
      forsaljningsinkomst: kr('4000'),
    });
    expect(
      [2024, 2025, 2026, 2027].map((ar) => linjarAvskrivningForAr(salt, ar)),
    ).toEqual([kr('2000'), kr('2000'), ZERO, ZERO]);
  });

  it('has the first year be a whole one even when bought on the last day of it', () => {
    expect(linjarAvskrivningForAr(tillgang('5000', '2026-12-31'), 2026)).toBe(kr('1000'));
  });

  it('writes the whole value off in one year for a period of one year', () => {
    expect(linjarAvskrivningForAr(tillgang('777.77', '2026-02-01', 1), 2026)).toBe(
      kr('777.77'),
    );
  });

  it('adds up to the acquisition value over the whole period, whatever the amount and the years', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5_000_000_00 }),
        fc.integer({ min: 1, max: 20 }),
        (ore, ar) => {
          const a = skapaAnlaggningstillgang({
            id: uuidv7(1_788_554_000_000 + (raknare += 1), new Uint8Array(10).fill(2)),
            benamning: 'X',
            anskaffningsdatum: datum('2024-01-01'),
            anskaffningsvarde: ore as never,
            nyttjandeperiod: ar,
          });
          const alla = Array.from({ length: ar }, (_, i) =>
            linjarAvskrivningForAr(a, 2024 + i),
          );
          return (
            sum(alla) === a.anskaffningsvarde && alla.every((belopp) => belopp >= ZERO)
          );
        },
      ),
    );
  });
});

describe('linjaraAvskrivningar', () => {
  it('lists the assets that have a depreciation this year and adds them up', () => {
    const ny = tillgang('10000', '2026-02-01');
    const gammal = tillgang('6000', '2024-01-01', 3); // 2024-2026: 2 000 a year
    const klar = tillgang('3000', '2020-01-01', 3); // finished in 2022

    const { rader, summa } = linjaraAvskrivningar([ny, gammal, klar], 2026);

    expect(rader.map((rad) => [rad.tillgang.id, rad.belopp])).toEqual([
      [ny.id, kr('2000')],
      [gammal.id, kr('2000')],
    ]);
    expect(summa).toBe(kr('4000'));
  });

  it('is nothing for an empty register', () => {
    expect(linjaraAvskrivningar([], 2026)).toEqual({ rader: [], summa: ZERO });
  });
});
