import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import { kontonummer } from '../konto/konto';
import { friaKonteringar, summeraFriaRader } from './frikontering';

const kr = oreFromKronor;

describe('friaKonteringar', () => {
  /*
   * A receipt with two VAT rates, the case no template can book:
   * 400 kr of feed at 25 % and 224 kr of food at 12 %, paid privately.
   *   4010 320,00 + 2640 80,00 + 4010 200,00 + 2640 24,00 = 624,00 = 2013
   */
  it('turns debet and kredit into signed konteringar', () => {
    const rader = friaKonteringar([
      { konto: kontonummer('4010'), debet: kr('320') },
      { konto: kontonummer('2640'), debet: kr('80') },
      { konto: kontonummer('4010'), debet: kr('200') },
      { konto: kontonummer('2640'), debet: kr('24') },
      { konto: kontonummer('2013'), kredit: kr('624') },
    ]);

    expect(rader.map((rad) => [rad.konto, rad.belopp])).toEqual([
      ['4010', kr('320')],
      ['2640', kr('80')],
      ['4010', kr('200')],
      ['2640', kr('24')],
      ['2013', kr('-624')],
    ]);
  });

  it('skips a row left empty, which is how the form offers a spare one', () => {
    expect(
      friaKonteringar([
        { konto: kontonummer('1930'), debet: kr('100') },
        {},
        { konto: kontonummer('2013'), kredit: kr('100') },
      ]),
    ).toHaveLength(2);
  });

  it('refuses a row with both debet and kredit', () => {
    expect(() =>
      friaKonteringar([
        { konto: kontonummer('1930'), debet: kr('100'), kredit: kr('100') },
        { konto: kontonummer('2013'), kredit: kr('100') },
      ]),
    ).toThrow('både debet och kredit');
  });

  it('refuses an amount on a row without an account, and an account without one', () => {
    expect(() => friaKonteringar([{ debet: kr('100') }])).toThrow('saknar konto');
    expect(() => friaKonteringar([{ konto: kontonummer('1930') }])).toThrow(
      'saknar belopp',
    );
  });

  it('refuses zero and negative amounts, which belong on the other side', () => {
    expect(() =>
      friaKonteringar([{ konto: kontonummer('1930'), debet: kr('0') }]),
    ).toThrow('större än noll');
    expect(() =>
      friaKonteringar([{ konto: kontonummer('1930'), kredit: kr('-5') }]),
    ).toThrow('större än noll');
  });
});

describe('summeraFriaRader', () => {
  it('adds up both sides and says what is left to balance', () => {
    expect(
      summeraFriaRader([
        { konto: kontonummer('4010'), debet: kr('320') },
        { konto: kontonummer('2640'), debet: kr('80') },
        { konto: kontonummer('2013'), kredit: kr('399.50') },
      ]),
    ).toEqual({ debet: kr('400'), kredit: kr('399.50'), skillnad: kr('0.50') });
  });
});
