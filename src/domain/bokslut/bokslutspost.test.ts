import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import { kontonummer } from '../konto/konto';
import {
  aterforing,
  BOKSLUTSPOSTER,
  bokslutskatalogFor,
  bokslutspostKonteringar,
  FORENINGENS_BOKSLUTSPOSTER,
  type Bokslutsposttyp,
  type Foreningsposttyp,
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
  it('puts a project on the income and the balance row but not on the moms', () => {
    const projekt = '019b76da-a800-7000-8000-000000000001' as Uuid;
    const konteringar = bokslutspostKonteringar({
      ...post('obetald_kundfaktura', '12500', 25),
      projekt,
    });

    expect(konteringar.map((rad) => [rad.konto, rad.projekt])).toEqual([
      ['1500', projekt],
      ['3000', projekt],
      ['2611', undefined],
    ]);
    // Turned round for the next year's first day, the project goes back with it.
    expect(aterforing(konteringar).map((rad) => rad.projekt)).toEqual([
      projekt,
      projekt,
      undefined,
    ]);
  });

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

describe('en förenings poster vid årets slut', () => {
  const forening = (typ: Foreningsposttyp, belopp: string) => {
    const beskrivning = FORENINGENS_BOKSLUTSPOSTER[typ];
    return rader(
      bokslutspostKonteringar(
        {
          typ,
          belopp: kr(belopp),
          motkonto: beskrivning.motkonto ?? kontonummer('3990'),
          balanskonto: beskrivning.balanskonto,
        },
        FORENINGENS_BOKSLUTSPOSTER,
      ),
    );
  };

  /*
   * A grant of 40 000 kr decided for the year and paid in January, for an
   * association that recognises grants in the year they relate to (7.3 b):
   * a fordran on 1600 on 31 December, income on 3710.
   */
  it('takes a decided grant up as a fordran and as income for the year (6.53, 7.3 b)', () => {
    expect(forening('beslutat_bidrag', '40000')).toEqual([
      ['1600', kr('40000')],
      ['3710', kr('-40000')],
    ]);
  });

  /*
   * 15 000 kr of a grant paid in December for next year: income taken back out
   * of this year and held as a skuld on 2900 (6.76).
   */
  it('holds the part of a grant paid for next year as a skuld (6.76)', () => {
    expect(forening('bidrag_for_kommande_ar', '15000')).toEqual([
      ['3710', kr('15000')],
      ['2900', kr('-15000')],
    ]);
  });

  it('puts no moms on an unpaid invoice, the moms being part of its amount', () => {
    // 12 500 kr billed for a rented hall and 6 250 kr owed to a supplier.
    expect(forening('obetald_kundfaktura', '12500')).toEqual([
      ['1510', kr('12500')],
      ['3811', kr('-12500')],
    ]);
    expect(forening('obetald_leverantorsfaktura', '6250')).toEqual([
      ['6390', kr('6250')],
      ['2440', kr('-6250')],
    ]);
  });

  it('takes an advance, and interest, up only above 5 000 kr', () => {
    for (const typ of [
      'forskott_fran_kund',
      'forskott_till_leverantor',
      'upplupen_ranteintakt',
      'upplupen_rantekostnad',
    ] as const) {
      expect(() => forening(typ, '5000'), typ).toThrow('5 000 kr');
      expect(forening(typ, '5000.01'), typ).toHaveLength(2);
    }
  });

  it('always balances, and the reversal takes every row back', () => {
    for (const typ of Object.keys(FORENINGENS_BOKSLUTSPOSTER) as Foreningsposttyp[]) {
      const beskrivning = FORENINGENS_BOKSLUTSPOSTER[typ];
      const konteringar = bokslutspostKonteringar(
        {
          typ,
          belopp: kr('12345.67'),
          motkonto: beskrivning.motkonto ?? kontonummer('3990'),
          balanskonto: beskrivning.balanskonto,
        },
        FORENINGENS_BOKSLUTSPOSTER,
      );
      expect(
        konteringar.reduce((summa, rad) => summa + rad.belopp, 0),
        typ,
      ).toBe(0);
      expect(
        [...konteringar, ...aterforing(konteringar)].reduce(
          (summa, rad) => summa + rad.belopp,
          0,
        ),
        typ,
      ).toBe(0);
    }
  });

  it('names BFNAR 2010:1 as the source of every item', () => {
    for (const post of Object.values(FORENINGENS_BOKSLUTSPOSTER)) {
      expect(post.kalla).toContain('BFNAR 2010:1');
    }
  });

  it("is what an association is offered, and the firm's list is what a firm is", () => {
    expect(bokslutskatalogFor('forening')).toBe(FORENINGENS_BOKSLUTSPOSTER);
    expect(bokslutskatalogFor('enskild_firma')).toBe(BOKSLUTSPOSTER);
  });

  it("is refused for a firm: the grant items are an association's alone", () => {
    expect(() =>
      bokslutspostKonteringar({
        typ: 'beslutat_bidrag',
        belopp: kr('1000'),
        motkonto: kontonummer('3710'),
        balanskonto: kontonummer('1600'),
      }),
    ).toThrow('tar inte upp');
  });
});

describe('aterforing och projekt', () => {
  it('turns a line round with its project, so the reversal belongs where the item did', () => {
    const projekt = '019b76da-a800-7000-8000-000000000042' as Uuid;
    const tillbaka = aterforing([
      { konto: kontonummer('1600'), belopp: kr('40000'), projekt },
      { konto: kontonummer('3710'), belopp: kr('-40000'), projekt },
    ]);
    expect(tillbaka).toEqual([
      { konto: '1600', belopp: kr('-40000'), projekt },
      { konto: '3710', belopp: kr('40000'), projekt },
    ]);
  });
});
