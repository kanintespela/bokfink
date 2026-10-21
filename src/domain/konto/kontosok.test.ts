import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { skapaKonto, type Konto } from './konto';
import { sokKonton } from './kontosok';

/** A slice of the BAS chart, with the names a SIE import gives them. */
const KONTON: readonly Konto[] = [
  skapaKonto({ nummer: '1930', namn: 'Företagskonto' }),
  skapaKonto({ nummer: '2611', namn: 'Utgående moms på försäljning inom Sverige, 25 %' }),
  skapaKonto({ nummer: '2640', namn: 'Ingående moms' }),
  skapaKonto({ nummer: '2641', namn: 'Debiterad ingående moms' }),
  skapaKonto({
    nummer: '2645',
    namn: 'Beräknad ingående moms på förvärv från utlandet',
  }),
  skapaKonto({ nummer: '2650', namn: 'Redovisningskonto för moms' }),
  skapaKonto({ nummer: '4000', namn: 'Inköp av varor från Sverige' }),
  skapaKonto({ nummer: '6570', namn: 'Bankkostnader' }),
  skapaKonto({ nummer: '8410', namn: 'Räntekostnader', typ: 'kostnad' }),
];

const nummer = (traffar: readonly Konto[]) => traffar.map((konto) => konto.nummer);

describe('sokKonton', () => {
  it('finds the input VAT accounts by a word in their names', () => {
    // 2640 starts with the word and ranks first; the other two have it inside.
    expect(nummer(sokKonton(KONTON, 'ingående'))).toEqual(['2640', '2641', '2645']);
  });

  it('folds case and accents, so the word can be typed without å', () => {
    expect(nummer(sokKonton(KONTON, 'INGAENDE'))).toEqual(['2640', '2641', '2645']);
  });

  it('finds by the start of the number', () => {
    expect(nummer(sokKonton(KONTON, '264'))).toEqual(['2640', '2641', '2645']);
    expect(nummer(sokKonton(KONTON, '1930'))).toEqual(['1930']);
  });

  it('wants every word found, in any order', () => {
    // "ing" also sits inside försäljning and Redovisningskonto, ranked after.
    expect(nummer(sokKonton(KONTON, 'moms ing'))).toEqual([
      '2640',
      '2641',
      '2645',
      '2611',
      '2650',
    ]);
    expect(nummer(sokKonton(KONTON, 'moms utlandet'))).toEqual(['2645']);
    expect(nummer(sokKonton(KONTON, 'moms 26 ut'))).toEqual(['2611', '2645']);
  });

  it('finds a word inside a compound, below whole-word matches', () => {
    // "kostnader" starts no word in either name but sits inside both.
    expect(nummer(sokKonton(KONTON, 'kostnader'))).toEqual(['6570', '8410']);
    // Likewise "konto", inside Företagskonto and Redovisningskonto.
    expect(nummer(sokKonton(KONTON, 'konto'))).toEqual(['1930', '2650']);
  });

  it('ranks a name that starts with what was typed above one that has it later', () => {
    expect(nummer(sokKonton(KONTON, 'ingående moms'))).toEqual(['2640', '2641', '2645']);
    // Every name has "moms" as a whole word, so only the number orders them.
    expect(nummer(sokKonton(KONTON, 'moms'))).toEqual([
      '2611',
      '2640',
      '2641',
      '2645',
      '2650',
    ]);
  });

  it('puts favourites first among equally good matches', () => {
    const medFavorit = KONTON.map((konto) =>
      konto.nummer === '2645' ? { ...konto, favorit: true } : konto,
    );
    expect(nummer(sokKonton(medFavorit, 'ingående'))).toEqual(['2640', '2645', '2641']);
  });

  it('finds nothing for empty input or input nothing matches', () => {
    expect(sokKonton(KONTON, '')).toEqual([]);
    expect(sokKonton(KONTON, '   ')).toEqual([]);
    expect(sokKonton(KONTON, 'hyra')).toEqual([]);
  });

  it('only ever returns accounts it was given, each at most once', () => {
    fc.assert(
      fc.property(fc.string(), (fraga) => {
        const traffar = sokKonton(KONTON, fraga);
        expect(new Set(traffar).size).toBe(traffar.length);
        expect(traffar.every((konto) => KONTON.includes(konto))).toBe(true);
      }),
    );
  });
});
