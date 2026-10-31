import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import { kontonummer } from '../konto/konto';
import { datum } from '../tid/datum';
import { verifikatserie } from '../verifikat/serie';
import { bokfor, skapaUtkast, type BokfortVerifikat } from '../verifikat/verifikat';
import { andraProjekt, OgiltigtProjektError, skapaProjekt } from './projekt';
import { budgetMotUtfall } from './projektbudget';
import { projektutdrag } from './projektutdrag';

const kr = oreFromKronor;
const post = (konto: string, belopp: string) => ({
  konto: kontonummer(konto),
  belopp: kr(belopp),
});
const UTAN_BUDGET = skapaProjekt({
  id: '019b76da-a800-7000-8000-0000000000a1' as Uuid,
  kod: 'LEADER-28',
  namn: 'Ny scen',
});

let nummer = 0;
function bokford(rader: readonly [string, string, boolean][]): BokfortVerifikat {
  nummer += 1;
  return bokfor(
    skapaUtkast({
      id: `019b76da-a800-7000-8000-${String(nummer).padStart(12, '0')}` as Uuid,
      datum: datum('2026-06-01'),
      beskrivning: 'Test',
      konteringar: rader.map(([konto, belopp, pa]) => ({
        ...post(konto, belopp),
        ...(pa ? { projekt: UTAN_BUDGET.id } : {}),
      })),
    }),
    {
      serie: verifikatserie('A'),
      nummer,
      bokfortDatum: datum('2026-06-01'),
      kalla: 'manuell',
    },
  );
}

describe('andraProjekt med budget', () => {
  it('sets the budget in account order, replaces it and takes it away', () => {
    const med = andraProjekt(UTAN_BUDGET, {
      budget: [post('6100', '10000'), post('3980', '20000')],
    });
    expect(med.budget?.map((rad) => rad.konto)).toEqual(['3980', '6100']);

    const ersatt = andraProjekt(med, { budget: [post('5010', '500')] });
    expect(ersatt.budget).toEqual([post('5010', '500')]);

    const borta = andraProjekt(ersatt, { budget: [] });
    expect(borta).not.toHaveProperty('budget');
    expect(borta).toEqual(UTAN_BUDGET);
  });

  it('keeps the budget when only the name changes', () => {
    const med = andraProjekt(UTAN_BUDGET, { budget: [post('6100', '10000')] });
    expect(andraProjekt(med, { namn: 'Annat' }).budget).toEqual(med.budget);
  });

  it('refuses a balance account, a financial item, nothing or less, and an account twice', () => {
    for (const budget of [
      [post('1930', '100')],
      [post('2900', '100')],
      [post('8310', '100')],
      [post('6100', '0')],
      [post('6100', '-5')],
      [post('6100', '100'), post('6100', '200')],
    ]) {
      expect(() => andraProjekt(UTAN_BUDGET, { budget })).toThrow(OgiltigtProjektError);
    }
  });
});

describe('budgetMotUtfall', () => {
  /*
   * Budget: 20 000 kr of grant (3980), 10 000 kr of office supplies (6100) and
   * 5 000 kr of rent (5010). Booked: 15 000 kr of grant, 12 000 kr of supplies
   * and 3 000 kr of material (4000) that nobody planned for.
   *
   *   3980  budget 20 000  utfall 15 000  kvar  5 000
   *   4000  budget      0  utfall  3 000  kvar -3 000
   *   5010  budget  5 000  utfall      0  kvar  5 000
   *   6100  budget 10 000  utfall 12 000  kvar -2 000
   *
   * Cost: budget 15 000, utfall 15 000, kvar 0. Result: budget 20 000 - 15 000
   * = 5 000, outcome 15 000 - 15 000 = 0.
   */
  const projekt = andraProjekt(UTAN_BUDGET, {
    budget: [post('3980', '20000'), post('6100', '10000'), post('5010', '5000')],
  });
  const jamforelse = budgetMotUtfall(
    projektutdrag(projekt, [
      bokford([
        ['1930', '15000', false],
        ['3980', '-15000', true],
      ]),
      bokford([
        ['6100', '12000', true],
        ['1930', '-12000', false],
      ]),
      bokford([
        ['4000', '3000', true],
        ['1930', '-3000', false],
      ]),
    ]),
  );
  const rader = (lista: typeof jamforelse.kostnader) =>
    lista.map((rad) => [rad.konto, rad.budget, rad.utfall, rad.kvar]);

  it('lists income and cost accounts with budget, outcome and what is left', () => {
    expect(rader(jamforelse.intakter)).toEqual([
      ['3980', kr('20000'), kr('15000'), kr('5000')],
    ]);
    expect(rader(jamforelse.kostnader)).toEqual([
      ['4000', kr('0'), kr('3000'), kr('-3000')],
      ['5010', kr('5000'), kr('0'), kr('5000')],
      ['6100', kr('10000'), kr('12000'), kr('-2000')],
    ]);
  });

  it('adds the groups up and sets the result, financial items left out', () => {
    expect(jamforelse.summaKostnader).toEqual({
      budget: kr('15000'),
      utfall: kr('15000'),
      kvar: kr('0'),
    });
    expect(jamforelse.summaIntakter.kvar).toBe(kr('5000'));
    expect(jamforelse.resultat).toEqual({ budget: kr('5000'), utfall: kr('0') });
  });

  it('is empty for a project with neither budget nor outcome', () => {
    const tom = budgetMotUtfall(projektutdrag(UTAN_BUDGET, []));
    expect(tom.intakter).toEqual([]);
    expect(tom.kostnader).toEqual([]);
    expect(tom.resultat).toEqual({ budget: kr('0'), utfall: kr('0') });
  });
});
