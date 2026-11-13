import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ore, sum, type Ore } from '../belopp/ore';
import { kontonummer } from '../konto/konto';
import { fordelaRepresentation, type Representationstyp } from './representation';

const kr = (kronor: number): Ore => ore(Math.round(kronor * 100));
const BANK = kontonummer('1930');

function fordela(typ: Representationstyp, brutto: number, moms: number, antal: number) {
  return fordelaRepresentation({
    typ,
    brutto: kr(brutto),
    moms: kr(moms),
    antal,
    betalkonto: BANK,
  });
}

const rader = (resultat: ReturnType<typeof fordela>) =>
  resultat.konteringar.map((rad) => [rad.konto, rad.belopp]);

describe('fordelaRepresentation', () => {
  /*
   * Skatteverket's own example: dinner for three, food 900 kr and beer 600 kr
   * excluding moms. Moms 12 % x 900 + 25 % x 600 = 108 + 150 = 258, so the
   * moms is deducted in proportion: 258 x (3 x 300) / 1 500 = 154,80.
   */
  it('deducts moms in proportion above 300 kr per person, as Skatteverket works it', () => {
    const resultat = fordela('maltid', 1758, 258, 3);
    expect(resultat.avdragsgillMoms).toBe(kr(154.8));
    // A meal is not deductible from the income, so all that is left is 6072.
    expect(resultat.avdragsgillKostnad).toBe(0);
    expect(resultat.ejAvdragsgillKostnad).toBe(kr(1758 - 154.8));
    expect(rader(resultat)).toEqual([
      [kontonummer('6072'), kr(1603.2)],
      [kontonummer('2641'), kr(154.8)],
      [BANK, kr(-1758)],
    ]);
  });

  it('deducts all of the moms when the cost is within 300 kr per person', () => {
    // 3 x 200 kr excluding moms, 12 % moms.
    const resultat = fordela('maltid', 672, 72, 3);
    expect(resultat.avdragsgillMoms).toBe(kr(72));
    expect(resultat.ejAvdragsgillKostnad).toBe(kr(600));
  });

  it('lets a coffee and a bun be deducted in full when it costs 60 kr a person or less', () => {
    // 3 persons, 100 kr excluding moms in all, 12 moms.
    const resultat = fordela('enklare', 112, 12, 3);
    expect(rader(resultat)).toEqual([
      [kontonummer('6071'), kr(100)],
      [kontonummer('2641'), kr(12)],
      [BANK, kr(-112)],
    ]);
  });

  it('allows nothing at all, not the part up to 60 kr, when it costs more than that', () => {
    // 2 persons, 150 kr excluding moms: 75 kr a person.
    const resultat = fordela('enklare', 168, 18, 2);
    expect(resultat.avdragsgillKostnad).toBe(0);
    expect(resultat.ejAvdragsgillKostnad).toBe(kr(150));
    // The moms is still within the 300 kr limit.
    expect(resultat.avdragsgillMoms).toBe(kr(18));
  });

  /*
   * Skatteverket's example: a bouquet for 650 kr including 25 % moms. The moms
   * is deducted on 300 kr of the 520 kr, which is 75 kr.
   */
  it('limits a gift to 300 kr for both the cost and the moms', () => {
    const resultat = fordela('gava', 650, 130, 1);
    expect(resultat.avdragsgillMoms).toBe(kr(75));
    expect(resultat.avdragsgillKostnad).toBe(kr(300));
    expect(resultat.ejAvdragsgillKostnad).toBe(kr(275));
  });

  it('deducts a cheap gift in full', () => {
    const resultat = fordela('gava', 250, 50, 1);
    expect(rader(resultat)).toEqual([
      [kontonummer('6071'), kr(200)],
      [kontonummer('2641'), kr(50)],
      [BANK, kr(-250)],
    ]);
  });

  it('leaves out the rows that are zero', () => {
    const resultat = fordela('maltid', 100, 0, 1);
    expect(resultat.konteringar.map((rad) => rad.konto)).toEqual(['6072', '1930']);
  });

  it('rounds the proportional moms to the nearest öre, halves away from zero', () => {
    // 1 person, 300,10 kr excluding moms, 75,03 kr moms: 7503 x 30000 / 30010 = 7500,0...
    const jamnt = fordela('maltid', 375.13, 75.03, 1);
    expect(jamnt.avdragsgillMoms).toBe(ore(7500));
    // 1 person, 1 000 kr excluding moms, 1 kr moms: 100 x 30000 / 100000 = 30 öre exactly.
    expect(fordela('maltid', 1001, 1, 1).avdragsgillMoms).toBe(ore(30));
    // 1 person, 400 kr excluding moms, 0,07 kr moms: 7 x 30000 / 40000 = 5,25 öre -> 5.
    expect(fordela('maltid', 400.07, 0.07, 1).avdragsgillMoms).toBe(ore(5));
    // ... and 0,06 kr: 6 x 30000 / 40000 = 4,5 öre -> 5, away from zero.
    expect(fordela('maltid', 400.06, 0.06, 1).avdragsgillMoms).toBe(ore(5));
  });

  it.each([
    ['no persons', () => fordela('maltid', 100, 20, 0), /hur många/],
    ['a fraction of a person', () => fordela('maltid', 100, 20, 1.5), /hur många/],
    ['no gifts', () => fordela('gava', 100, 20, 0), /gåvor/],
    ['a zero amount', () => fordela('maltid', 0, 0, 1), /större än noll/],
    ['a negative amount', () => fordela('maltid', -100, 0, 1), /större än noll/],
    ['moms as large as the amount', () => fordela('maltid', 100, 100, 1), /Momsen/],
    ['negative moms', () => fordela('maltid', 100, -5, 1), /Momsen/],
  ])('refuses %s', (_namn, anrop, meddelande) => {
    expect(anrop).toThrow(meddelande);
  });

  it('refuses a payment account that is not one the app offers', () => {
    expect(() =>
      fordelaRepresentation({
        typ: 'maltid',
        brutto: kr(100),
        moms: kr(20),
        antal: 1,
        betalkonto: kontonummer('2440'),
      }),
    ).toThrow(/betalkonto/);
  });

  it('always balances, never deducts more moms than there is, and splits exactly what was paid', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<Representationstyp>('maltid', 'enklare', 'gava'),
        fc.integer({ min: 100, max: 5_000_000 }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 1, max: 40 }),
        (typ, bruttoOre, momsPromille, antal) => {
          const brutto = ore(bruttoOre);
          const moms = ore(
            Math.min(bruttoOre - 1, Math.floor((bruttoOre * momsPromille) / 500)),
          );
          const resultat = fordelaRepresentation({
            typ,
            brutto,
            moms,
            antal,
            betalkonto: BANK,
          });
          expect(sum(resultat.konteringar.map((rad) => rad.belopp))).toBe(0);
          expect(resultat.avdragsgillMoms).toBeGreaterThanOrEqual(0);
          expect(resultat.avdragsgillMoms).toBeLessThanOrEqual(moms);
          expect(resultat.avdragsgillKostnad).toBeGreaterThanOrEqual(0);
          expect(resultat.ejAvdragsgillKostnad).toBeGreaterThanOrEqual(0);
          expect(
            resultat.avdragsgillMoms +
              resultat.avdragsgillKostnad +
              resultat.ejAvdragsgillKostnad,
          ).toBe(brutto);
        },
      ),
    );
  });
});
