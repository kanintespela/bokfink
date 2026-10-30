import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { oreFromKronor, ZERO } from '../belopp/ore';
import { uuidv7, type Uuid } from '../id/uuidv7';
import { kontonummer } from '../konto/konto';
import type { BokfortVerifikat } from '../verifikat/verifikat';
import { resultatoverforingKonteringar } from './egetkapital';
import {
  arReserveringskonto,
  beraknaForeningskapital,
  reserveringKonteringar,
} from './foreningskapital';

let n = 0;
function verifikat(
  rader: readonly (readonly [string, string])[],
  extra: Partial<BokfortVerifikat> = {},
): BokfortVerifikat {
  return {
    id: uuidv7((n += 1), new Uint8Array(10).fill(1)) as Uuid,
    datum: '2026-06-01',
    konteringar: rader.map(([konto, belopp]) => ({
      konto: kontonummer(konto),
      belopp: oreFromKronor(belopp),
    })),
    ...extra,
  } as unknown as BokfortVerifikat;
}

const IB = [
  { konto: kontonummer('1930'), belopp: oreFromKronor('100000') },
  { konto: kontonummer('2010'), belopp: oreFromKronor('-60000') },
  { konto: kontonummer('2399'), belopp: oreFromKronor('-40000') },
];

describe('beraknaForeningskapital', () => {
  it('räknar ingående kapital, årets resultat och utgående kapital', () => {
    const kapital = beraknaForeningskapital({
      ingaendeBalanser: IB,
      verifikat: [],
      reserveradeKonton: [],
      resultat: oreFromKronor('12000'),
    });

    // 60 000 i kapital in, 12 000 i överskott: 72 000 ut. 399-skulden är inte kapital.
    expect(kapital.ingaende).toBe(oreFromKronor('60000'));
    expect(kapital.aretsResultat).toBe(oreFromKronor('12000'));
    expect(kapital.utgaende).toBe(oreFromKronor('72000'));
    expect(kapital.balanserat).toBe(oreFromKronor('60000'));
    expect(kapital.fritt).toBe(oreFromKronor('72000'));
  });

  it('visar ett underskott som minskning', () => {
    const kapital = beraknaForeningskapital({
      ingaendeBalanser: IB,
      verifikat: [],
      reserveradeKonton: [],
      resultat: oreFromKronor('-5000'),
    });
    expect(kapital.utgaende).toBe(oreFromKronor('55000'));
  });

  it('delar det balanserade i reserverat och fritt utan att ändra summan (6.67)', () => {
    const kapital = beraknaForeningskapital({
      ingaendeBalanser: IB,
      verifikat: [
        verifikat([
          ['2010', '15000'],
          ['2030', '-15000'],
        ]),
      ],
      reserveradeKonton: [kontonummer('2030')],
      resultat: ZERO,
    });

    expect(kapital.utgaende).toBe(oreFromKronor('60000'));
    expect(kapital.summaReserverat).toBe(oreFromKronor('15000'));
    expect(kapital.fritt).toBe(oreFromKronor('45000'));
    expect(kapital.reserverade).toEqual([
      { konto: '2030', ingaende: ZERO, utgaende: oreFromKronor('15000') },
    ]);
  });

  it('bär en reservering över årsskiftet via ingående balans', () => {
    const kapital = beraknaForeningskapital({
      ingaendeBalanser: [
        { konto: kontonummer('2010'), belopp: oreFromKronor('-45000') },
        { konto: kontonummer('2030'), belopp: oreFromKronor('-15000') },
      ],
      verifikat: [
        verifikat([
          ['2030', '4000'],
          ['2010', '-4000'],
        ]),
      ],
      reserveradeKonton: [kontonummer('2030')],
      resultat: ZERO,
    });
    expect(kapital.reserverade[0]).toEqual({
      konto: '2030',
      ingaende: oreFromKronor('15000'),
      utgaende: oreFromKronor('11000'),
    });
    expect(kapital.utgaende).toBe(oreFromKronor('60000'));
  });

  it('räknar inte årets resultat två gånger när det har förts över till kapitalkontot', () => {
    const resultat = oreFromKronor('12000');
    const utanOverforing = beraknaForeningskapital({
      ingaendeBalanser: IB,
      verifikat: [],
      reserveradeKonton: [],
      resultat,
    });
    const medOverforing = beraknaForeningskapital({
      ingaendeBalanser: IB,
      verifikat: [
        verifikat(
          resultatoverforingKonteringar(resultat).map(
            (rad) => [rad.konto, kronor(rad.belopp)] as const,
          ),
        ),
      ],
      reserveradeKonton: [],
      resultat,
    });
    expect(medOverforing.utgaende).toBe(utanOverforing.utgaende);
  });

  it('räknar med det som bokförts direkt på kapitalkontona', () => {
    const kapital = beraknaForeningskapital({
      ingaendeBalanser: IB,
      verifikat: [
        verifikat([
          ['1930', '3000'],
          ['2010', '-3000'],
        ]),
      ],
      reserveradeKonton: [],
      resultat: ZERO,
    });
    expect(kapital.utgaende).toBe(oreFromKronor('63000'));
  });

  it('ändras aldrig av en reservering eller en frigöring, vad beloppen än är', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 5_000_000 }), fc.boolean()), {
          maxLength: 8,
        }),
        fc.integer({ min: -2_000_000, max: 2_000_000 }),
        (rorelser, resultatOre) => {
          const rader = rorelser.map(([ore, reservera]) =>
            verifikat(
              reserveringKonteringar(
                kontonummer('2030'),
                ore as unknown as ReturnType<typeof oreFromKronor>,
                reservera ? 'reservera' : 'frigor',
              ).map((rad) => [rad.konto, kronor(rad.belopp)] as const),
            ),
          );
          const resultat = resultatOre as unknown as ReturnType<typeof oreFromKronor>;
          const fore = beraknaForeningskapital({
            ingaendeBalanser: IB,
            verifikat: [],
            reserveradeKonton: [kontonummer('2030')],
            resultat,
          });
          const efter = beraknaForeningskapital({
            ingaendeBalanser: IB,
            verifikat: rader,
            reserveradeKonton: [kontonummer('2030')],
            resultat,
          });
          return (
            efter.utgaende === fore.utgaende && efter.aretsResultat === fore.aretsResultat
          );
        },
      ),
    );
  });
});

/** Back to the kronor string the helper above takes. */
function kronor(ore: number): string {
  return (ore / 100).toFixed(2);
}

describe('reserveringKonteringar', () => {
  it('flyttar kapital från 2010 till ändamålet, och tillbaka', () => {
    expect(
      reserveringKonteringar(kontonummer('2030'), oreFromKronor('500'), 'reservera'),
    ).toEqual([
      { konto: '2010', belopp: oreFromKronor('500') },
      { konto: '2030', belopp: oreFromKronor('-500') },
    ]);
    expect(
      reserveringKonteringar(kontonummer('2030'), oreFromKronor('500'), 'frigor'),
    ).toEqual([
      { konto: '2030', belopp: oreFromKronor('500') },
      { konto: '2010', belopp: oreFromKronor('-500') },
    ]);
  });

  it('balanserar alltid', () => {
    for (const riktning of ['reservera', 'frigor'] as const) {
      const summa = reserveringKonteringar(
        kontonummer('2044'),
        oreFromKronor('123.45'),
        riktning,
      ).reduce((s, rad) => s + rad.belopp, 0);
      expect(summa).toBe(0);
    }
  });

  it('vägrar noll, negativt belopp och konton utanför 2020-2049', () => {
    expect(() => reserveringKonteringar(kontonummer('2030'), ZERO, 'reservera')).toThrow(
      /större än noll/,
    );
    expect(() =>
      reserveringKonteringar(kontonummer('2030'), oreFromKronor('-1'), 'reservera'),
    ).toThrow(/större än noll/);
    for (const konto of ['2010', '2019', '2019', '2050', '2399', '1930']) {
      expect(() =>
        reserveringKonteringar(kontonummer(konto), oreFromKronor('1'), 'reservera'),
      ).toThrow(/kan inte ta reserverade medel/);
    }
  });
});

describe('arReserveringskonto', () => {
  it('är 2020 till 2049', () => {
    expect(arReserveringskonto(kontonummer('2020'))).toBe(true);
    expect(arReserveringskonto(kontonummer('2049'))).toBe(true);
    expect(arReserveringskonto(kontonummer('2019'))).toBe(false);
    expect(arReserveringskonto(kontonummer('2050'))).toBe(false);
  });
});
