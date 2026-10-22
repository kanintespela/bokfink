import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import { kontonummer } from '../konto/konto';
import {
  aterforing,
  BOKSLUTSPOSTER,
  bokslutspostKonteringar,
  type Bokslutsposttyp,
} from './bokslutspost';

const kr = oreFromKronor;
const rader = (konteringar: readonly { konto: string; belopp: number }[]) =>
  konteringar.map((rad) => [rad.konto, rad.belopp]);

function post(typ: Bokslutsposttyp, belopp: string, momssats?: number) {
  const beskrivning = BOKSLUTSPOSTER[typ];
  return {
    typ,
    belopp: kr(belopp),
    ...(momssats === undefined ? {} : { momssats }),
    motkonto: beskrivning.motkonto ?? kontonummer('3990'),
    balanskonto: beskrivning.balanskonto,
  };
}

describe('bokslutspostKonteringar', () => {
  /*
   * 12 500 kr invoiced with 25 % moms and unpaid on 31 December:
   *   1500 kundfordran 12 500, 3000 försäljning -10 000, 2611 moms -2 500
   */
  it('books an unpaid customer invoice as if it had been paid into 1500', () => {
    expect(
      rader(bokslutspostKonteringar(post('obetald_kundfaktura', '12500', 25))),
    ).toEqual([
      ['1500', kr('12500')],
      ['3000', kr('-10000')],
      ['2611', kr('-2500')],
    ]);
  });

  it('books an unpaid supplier invoice against 2440, input moms on 2641', () => {
    expect(
      rader(bokslutspostKonteringar(post('obetald_leverantorsfaktura', '6250', 25))),
    ).toEqual([
      ['4000', kr('5000')],
      ['2641', kr('1250')],
      ['2440', kr('-6250')],
    ]);
  });

  it('uses the output account for the rate of a 12 % sale', () => {
    expect(
      rader(bokslutspostKonteringar(post('obetald_kundfaktura', '1120', 12))),
    ).toEqual([
      ['1500', kr('1120')],
      ['3000', kr('-1000')],
      ['2621', kr('-120')],
    ]);
  });

  it('moves a förskott to a supplier off the cost account onto 1700', () => {
    expect(
      rader(bokslutspostKonteringar(post('forskott_till_leverantor', '8000'))),
    ).toEqual([
      ['1700', kr('8000')],
      ['4000', kr('-8000')],
    ]);
  });

  it('moves a förskott from a customer off the income account onto 2900', () => {
    expect(rader(bokslutspostKonteringar(post('forskott_fran_kund', '8000')))).toEqual([
      ['3000', kr('8000')],
      ['2900', kr('-8000')],
    ]);
  });

  it('books unpaid interest costs as a skuld and interest to come as a fordran', () => {
    expect(rader(bokslutspostKonteringar(post('upplupen_rantekostnad', '6000')))).toEqual(
      [
        ['8410', kr('6000')],
        ['2900', kr('-6000')],
      ],
    );
    expect(rader(bokslutspostKonteringar(post('upplupen_ranteintakt', '6000')))).toEqual([
      ['1600', kr('6000')],
      ['8310', kr('-6000')],
    ]);
  });

  /*
   * "Överstigande 5 000 kr": exactly 5 000 is not taken up, 5 000,01 is.
   */
  it('refuses a förskott or an interest of 5 000 kr or less, by the rule', () => {
    expect(() =>
      bokslutspostKonteringar(post('forskott_till_leverantor', '5000')),
    ).toThrow('överstiger 5 000 kr');
    expect(() => bokslutspostKonteringar(post('upplupen_rantekostnad', '5000'))).toThrow(
      'punkt 6.73',
    );
    expect(() =>
      bokslutspostKonteringar(post('forskott_till_leverantor', '5000.01')),
    ).not.toThrow();
  });

  it('takes up an unpaid invoice of any size, since K1 sets no limit for it', () => {
    expect(() =>
      bokslutspostKonteringar(post('obetald_leverantorsfaktura', '100', 25)),
    ).not.toThrow();
  });

  it('refuses nothing and less', () => {
    expect(() => bokslutspostKonteringar(post('beslutad_ersattning', '0'))).toThrow(
      'större än noll',
    );
  });

  it('always balances', () => {
    for (const typ of Object.keys(BOKSLUTSPOSTER) as Bokslutsposttyp[]) {
      const konteringar = bokslutspostKonteringar(
        post(typ, '12345.67', BOKSLUTSPOSTER[typ].medMoms ? 25 : undefined),
      );
      expect(konteringar.reduce((summa, rad) => summa + rad.belopp, 0)).toBe(0);
    }
  });
});

describe('aterforing', () => {
  it('turns every row round, for the first day of next year', () => {
    const tagetUpp = bokslutspostKonteringar(post('obetald_kundfaktura', '12500', 25));
    expect(rader(aterforing(tagetUpp))).toEqual([
      ['1500', kr('-12500')],
      ['3000', kr('10000')],
      ['2611', kr('2500')],
    ]);
  });
});
