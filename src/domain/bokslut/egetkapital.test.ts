import { describe, expect, it } from 'vitest';

import { oreFromKronor, ZERO } from '../belopp/ore';
import { kontonummer } from '../konto/konto';
import {
  arEgetKapitalUnderkonto,
  arResultatoverforing,
  beraknaUtgaendeEgetKapital,
  omforingAvEgetKapitalUnderkonton,
  resultatoverforingKonteringar,
} from './egetkapital';

describe('beraknaUtgaendeEgetKapital', () => {
  it('ökar med insättningar och årets resultat, minskar med uttag', () => {
    const ub = beraknaUtgaendeEgetKapital(
      oreFromKronor('100000'),
      oreFromKronor('60000'),
      oreFromKronor('10000'),
      oreFromKronor('45000'),
    );
    expect(ub).toBe(oreFromKronor('95000'));
  });

  it('kan bli negativt när uttagen överstiger allt annat', () => {
    const ub = beraknaUtgaendeEgetKapital(
      oreFromKronor('10000'),
      oreFromKronor('60000'),
      ZERO,
      oreFromKronor('5000'),
    );
    expect(ub).toBe(oreFromKronor('-45000'));
  });

  it('lämnar det ingående orört utan uttag, insättningar eller resultat', () => {
    const ub = beraknaUtgaendeEgetKapital(oreFromKronor('20000'), ZERO, ZERO, ZERO);
    expect(ub).toBe(oreFromKronor('20000'));
  });
});

describe('resultatoverforingKonteringar', () => {
  it('debiterar 8999 och krediterar 2019 med samma belopp för en vinst', () => {
    expect(resultatoverforingKonteringar(oreFromKronor('45000'))).toEqual([
      { konto: '8999', belopp: oreFromKronor('45000') },
      { konto: '2019', belopp: oreFromKronor('-45000') },
    ]);
  });

  it('vänder om för en förlust, så 2010-gruppen minskar', () => {
    expect(resultatoverforingKonteringar(oreFromKronor('-12000'))).toEqual([
      { konto: '8999', belopp: oreFromKronor('-12000') },
      { konto: '2019', belopp: oreFromKronor('12000') },
    ]);
  });

  it('balanserar alltid, som varje verifikat måste (hård regel 4)', () => {
    const rader = resultatoverforingKonteringar(oreFromKronor('317450'));
    expect(rader.reduce((summa, rad) => summa + rad.belopp, 0)).toBe(0);
  });
});

describe('arResultatoverforing', () => {
  it('känner igen sina egna rader', () => {
    expect(
      arResultatoverforing(resultatoverforingKonteringar(oreFromKronor('1000'))),
    ).toBe(true);
  });

  it('säger nej till en vanlig kontering', () => {
    expect(
      arResultatoverforing([
        { konto: kontonummer('1930'), belopp: oreFromKronor('100') },
        { konto: kontonummer('3000'), belopp: oreFromKronor('-100') },
      ]),
    ).toBe(false);
  });
});

describe('arEgetKapitalUnderkonto', () => {
  it('räknar skattekontot, uttag, insättningar och årets resultat dit', () => {
    for (const konto of ['2012', '2013', '2017', '2019']) {
      expect(arEgetKapitalUnderkonto(kontonummer(konto))).toBe(true);
    }
  });

  it('räknar inte huvudkontot självt, eller ett konto utanför gruppen', () => {
    expect(arEgetKapitalUnderkonto(kontonummer('2010'))).toBe(false);
    expect(arEgetKapitalUnderkonto(kontonummer('1930'))).toBe(false);
    expect(arEgetKapitalUnderkonto(kontonummer('2650'))).toBe(false);
  });
});

describe('omforingAvEgetKapitalUnderkonton', () => {
  it('nollar varje underkonto och samlar summan på 2010', () => {
    const rader = omforingAvEgetKapitalUnderkonton([
      { konto: kontonummer('2012'), belopp: oreFromKronor('-3000') },
      { konto: kontonummer('2013'), belopp: oreFromKronor('60000') },
      { konto: kontonummer('2017'), belopp: oreFromKronor('-10000') },
      { konto: kontonummer('2019'), belopp: oreFromKronor('-45000') },
      // Redan 0 - ska varken tas med som en nollrad eller räknas i summan.
      { konto: kontonummer('2018'), belopp: ZERO },
    ]);

    expect(rader).toEqual([
      { konto: '2012', belopp: oreFromKronor('3000') },
      { konto: '2013', belopp: oreFromKronor('-60000') },
      { konto: '2017', belopp: oreFromKronor('10000') },
      { konto: '2019', belopp: oreFromKronor('45000') },
      { konto: '2010', belopp: oreFromKronor('2000') },
    ]);
    expect(rader.reduce((summa, rad) => summa + rad.belopp, 0)).toBe(0);
  });

  it('lämnar 2010 självt och konton utanför eget kapital orörda', () => {
    const rader = omforingAvEgetKapitalUnderkonton([
      { konto: kontonummer('2010'), belopp: oreFromKronor('100000') },
      { konto: kontonummer('1930'), belopp: oreFromKronor('50000') },
    ]);
    expect(rader).toEqual([]);
  });

  it('blir tomt utan något underkonto att flytta', () => {
    expect(omforingAvEgetKapitalUnderkonton([])).toEqual([]);
  });
});
