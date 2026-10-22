import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { add, negate, ore, oreFromKronor, ZERO, type Ore } from '../belopp/ore';
import { kontonummer, type Kontonummer } from '../konto/konto';
import type { Kontosaldo } from '../rapport/saldon';
import {
  arGiltigtRutval,
  beraknaForenkladArsbokslut,
  placeringForKonto,
  type Resultatrad,
} from './forenkladArsbokslut';

const kr = (text: string): Ore => oreFromKronor(text);
const k = kontonummer;

/**
 * A year's closing balances, built from balanced pairs of bookings so that
 * the ledger always adds up to zero - the way beraknaSaldon's output does.
 */
function bokfor(
  ...rader: readonly [debet: string, kredit: string, kronor: string][]
): Map<Kontonummer, Kontosaldo> {
  return bokforOre(rader.map(([debet, kredit, kronor]) => [debet, kredit, kr(kronor)]));
}

function bokforOre(
  rader: readonly (readonly [debet: string, kredit: string, belopp: Ore])[],
): Map<Kontonummer, Kontosaldo> {
  const saldon = new Map<Kontonummer, Kontosaldo>();
  const flytta = (konto: string, belopp: Ore) => {
    const nu = saldon.get(k(konto))?.utgaende ?? ZERO;
    const utgaende = add(nu, belopp);
    saldon.set(k(konto), {
      konto: k(konto),
      ingaende: ZERO,
      forandring: utgaende,
      utgaende,
    });
  };
  for (const [debet, kredit, belopp] of rader) {
    flytta(debet, belopp);
    flytta(kredit, negate(belopp));
  }
  return saldon;
}

describe('placeringForKonto', () => {
  const rad = (konto: string) => {
    const placering = placeringForKonto(k(konto));
    return placering?.typ === 'rad' ? placering.rad : placering?.typ;
  };

  it('skiljer byggnader och markanläggningar (B2) från mark (B3)', () => {
    expect(rad('1110')).toBe('B2');
    expect(rad('1119')).toBe('B2'); // Ackumulerade avskrivningar följer tillgången
    expect(rad('1150')).toBe('B2');
    expect(rad('1130')).toBe('B3');
    expect(rad('1180')).toBe('B3');
  });

  it('lägger moms och personalens skatter i B14, som BAS-tabellen', () => {
    expect(rad('2610')).toBe('B14');
    expect(rad('2641')).toBe('B14');
    expect(rad('2650')).toBe('B14');
    expect(rad('2710')).toBe('B14');
  });

  it('håller upplysningarna och deras utjämningskonto utanför B10', () => {
    expect(rad('2010')).toBe('eget-kapital');
    expect(rad('2019')).toBe('eget-kapital');
    expect(rad('2080')).toBe('U1');
    expect(rad('2089')).toBe('U1');
    expect(rad('2050')).toBe('U2');
    expect(rad('2060')).toBe('U3');
    expect(rad('2070')).toBe('U4');
    expect(rad('2090')).toBe('utjamning');
  });

  it('lägger avskrivningar på byggnader i R9 och på maskiner och immateriella i R10', () => {
    expect(rad('7820')).toBe('R9');
    expect(rad('7810')).toBe('R10');
    expect(rad('7830')).toBe('R10');
    expect(rad('7832')).toBe('R10');
  });

  it('täcker kontona i den egna bokföringen', () => {
    expect(rad('1229')).toBe('B4');
    expect(rad('1630')).toBe('B8');
    expect(rad('1650')).toBe('B8');
    expect(rad('1400')).toBe('B6');
    expect(rad('1930')).toBe('B9');
    expect(rad('3010')).toBe('R1');
    expect(rad('3540')).toBe('R1');
    expect(rad('4990')).toBe('R5');
    expect(rad('6981')).toBe('R6');
    expect(rad('8999')).toBe('resultatoverforing');
  });

  it('kräver ett val där BAS själv anger två rutor', () => {
    expect(placeringForKonto(k('3740'))).toEqual({
      typ: 'val',
      alternativ: ['R1', 'R2'],
    });
    expect(placeringForKonto(k('3990'))).toEqual({
      typ: 'val',
      alternativ: ['R1', 'R2'],
    });
    expect(placeringForKonto(k('7720'))).toEqual({
      typ: 'val',
      alternativ: ['R9', 'R10'],
    });
    expect(placeringForKonto(k('7980'))).toEqual({
      typ: 'val',
      alternativ: ['R9', 'R10'],
    });
  });

  it('lägger vinst vid avyttring och bidrag i R2 utan val', () => {
    expect(rad('3970')).toBe('R2');
    expect(rad('3980')).toBe('R2');
  });

  it('ger ingen ruta åt grupper K1-tabellen utelämnar', () => {
    for (const konto of ['1810', '2110', '2510', '2890', '3610', '4810', '8811']) {
      expect(placeringForKonto(k(konto))).toBeUndefined();
    }
  });
});

describe('arGiltigtRutval', () => {
  it('godtar bara en av de två rutor BAS anger för kontot', () => {
    expect(arGiltigtRutval(k('3740'), 'R1')).toBe(true);
    expect(arGiltigtRutval(k('3740'), 'R2')).toBe(true);
    expect(arGiltigtRutval(k('3740'), 'R9')).toBe(false);
    expect(arGiltigtRutval(k('7720'), 'R10')).toBe(true);
    // 3010 har en enda ruta och tar inget val alls.
    expect(arGiltigtRutval(k('3010'), 'R1')).toBe(false);
  });
});

describe('beraknaForenkladArsbokslut', () => {
  // Ett litet lantbruksår, handräknat:
  //   IB via 2010: bank 40 000, byggnad 80 000, ack. avskrivning -6 000
  //   Försäljning 60 000 + moms 15 000, inköp 20 000 + moms 5 000
  //   Avskrivning byggnad 3 000, maskiner 2 000 (mot 1229, IB 10 000 på 1220)
  //   Eget uttag 8 000, momsskuld kvar: 15 000 - 5 000 = 10 000
  const ARET: readonly [string, string, string][] = [
    ['1930', '2010', '40000'],
    ['1110', '2010', '80000'],
    ['2010', '1119', '6000'],
    ['1220', '2010', '10000'],
    ['1930', '3010', '60000'],
    ['1930', '2610', '15000'],
    ['4010', '1930', '20000'],
    ['2640', '1930', '5000'],
    ['7820', '1119', '3000'],
    ['7830', '1229', '2000'],
    ['2013', '1930', '8000'],
  ];

  it('sorterar ett handräknat år till rätt rutor', () => {
    const bokslut = beraknaForenkladArsbokslut(bokfor(...ARET));
    const ruta = (rad: string) => bokslut.rutor.get(rad as never)?.belopp;

    // 1110 80 000 - 1119 9 000
    expect(ruta('B2')).toBe(kr('71000'));
    // 1220 10 000 - 1229 2 000
    expect(ruta('B4')).toBe(kr('8000'));
    // 40 000 + 60 000 + 15 000 - 20 000 - 5 000 - 8 000
    expect(ruta('B9')).toBe(kr('82000'));
    // 2610 15 000 kredit, 2640 5 000 debet
    expect(ruta('B14')).toBe(kr('10000'));
    expect(ruta('R1')).toBe(kr('60000'));
    expect(ruta('R5')).toBe(kr('20000'));
    expect(ruta('R9')).toBe(kr('3000'));
    expect(ruta('R10')).toBe(kr('2000'));

    // 60 000 - 20 000 - 3 000 - 2 000
    expect(bokslut.bokfortResultat).toBe(kr('35000'));
    expect(bokslut.resultatEnligtBokforingen).toBe(kr('35000'));
    // IB 124 000 - uttag 8 000 + resultat 35 000
    expect(ruta('B10')).toBe(kr('151000'));
    expect(bokslut.resultatEjOverfortTillEgetKapital).toBe(kr('35000'));

    // 71 000 + 8 000 + 82 000 = 151 000 + 10 000
    expect(bokslut.summaTillgangar).toBe(kr('161000'));
    expect(bokslut.summaEgetKapitalOchSkulder).toBe(kr('161000'));
    expect(bokslut.differens).toBe(ZERO);
    expect(bokslut.resultatdifferens).toBe(ZERO);
  });

  it('ger samma B10 och R11 efter en bokslutspost 8999 mot 2019, som andra program bokar', () => {
    const fore = beraknaForenkladArsbokslut(bokfor(...ARET));
    const efter = beraknaForenkladArsbokslut(bokfor(...ARET, ['8999', '2019', '35000']));

    expect(efter.rutor.get('B10')?.belopp).toBe(fore.rutor.get('B10')?.belopp);
    expect(efter.bokfortResultat).toBe(kr('35000'));
    expect(efter.resultatEnligtBokforingen).toBe(kr('35000'));
    expect(efter.resultatEjOverfortTillEgetKapital).toBe(ZERO);
    expect(efter.differens).toBe(ZERO);
    expect(efter.resultatdifferens).toBe(ZERO);
  });

  it('visar periodiseringsfond som upplysning utan att röra B10', () => {
    const bokslut = beraknaForenkladArsbokslut(bokfor(...ARET, ['2090', '2080', '7000']));
    expect(bokslut.rutor.get('U1')?.belopp).toBe(kr('7000'));
    expect(bokslut.rutor.get('B10')?.belopp).toBe(kr('151000'));
    expect(bokslut.differens).toBe(ZERO);
  });

  it('listar ett konto utan ruta och låter det synas som differens', () => {
    const bokslut = beraknaForenkladArsbokslut(bokfor(...ARET, ['1810', '1930', '4000']));
    expect(bokslut.kontonUtanRuta.map((saldo) => saldo.konto)).toEqual(['1810']);
    expect(bokslut.differens).toBe(kr('-4000'));
    expect(bokslut.resultatdifferens).toBe(ZERO);
  });

  it('listar ett resultatkonto utan ruta och låter det synas som resultatdifferens', () => {
    const bokslut = beraknaForenkladArsbokslut(bokfor(...ARET, ['3610', '1930', '-500']));
    // Kredit 500 på ett intäktskonto utan ruta: R11 saknar 500.
    expect(bokslut.kontonUtanRuta.map((saldo) => saldo.konto)).toEqual(['3610']);
    expect(bokslut.resultatdifferens).toBe(kr('-500'));
    // B10 tar in hela årets resultat ur bokföringen, så balansen går ihop.
    expect(bokslut.differens).toBe(ZERO);
  });

  it('lämnar en tvetydig post utanför R1-R10 tills användaren valt', () => {
    const saldon = bokfor(...ARET, ['1930', '3740', '0.40']);
    const utanVal = beraknaForenkladArsbokslut(saldon);

    expect(utanVal.kraverVal).toEqual([
      { konto: k('3740'), alternativ: ['R1', 'R2'], belopp: kr('0.40') },
    ]);
    expect(utanVal.rutor.get('R1')?.belopp).toBe(kr('60000'));
    expect(utanVal.resultatdifferens).toBe(kr('-0.40'));

    const medVal = beraknaForenkladArsbokslut(
      saldon,
      new Map<Kontonummer, Resultatrad>([[k('3740'), 'R2']]),
    );
    expect(medVal.kraverVal).toEqual([]);
    expect(medVal.rutor.get('R2')?.belopp).toBe(kr('0.40'));
    expect(medVal.resultatdifferens).toBe(ZERO);
  });

  it('vägrar ett val som inte är ett av BAS alternativ', () => {
    const saldon = bokfor(['1930', '3740', '1']);
    expect(() =>
      beraknaForenkladArsbokslut(saldon, new Map([[k('3740'), 'R6' as Resultatrad]])),
    ).toThrow(TypeError);
    expect(() =>
      beraknaForenkladArsbokslut(saldon, new Map([[k('3010'), 'R1' as Resultatrad]])),
    ).toThrow(TypeError);
  });

  it('hoppar över nollsaldon', () => {
    const bokslut = beraknaForenkladArsbokslut(bokfor(['1930', '3010', '0']));
    expect(bokslut.rutor.size).toBe(0);
    expect(bokslut.kontonUtanRuta).toEqual([]);
  });

  it('ger noll utan konton alls', () => {
    const bokslut = beraknaForenkladArsbokslut(new Map());
    expect(bokslut.summaTillgangar).toBe(ZERO);
    expect(bokslut.bokfortResultat).toBe(ZERO);
    expect(bokslut.differens).toBe(ZERO);
  });

  /*
   * The invariant the form rests on: any balanced bookkeeping over accounts
   * the table places balances on the form too, and R11 equals the ledger's
   * own result - with or without a closing entry.
   */
  it('går ihop för varje bokföring över konton med en ruta', () => {
    const konton = [
      '1110',
      '1119',
      '1130',
      '1220',
      '1229',
      '1400',
      '1510',
      '1650',
      '1930',
      '2010',
      '2013',
      '2019',
      '2350',
      '2440',
      '2610',
      '2640',
      '2650',
      '2900',
      '3010',
      '3100',
      '3540',
      '3980',
      '4010',
      '4990',
      '5410',
      '6981',
      '7010',
      '7820',
      '7830',
      '8310',
      '8410',
      '8999',
    ];
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom(...konton),
            fc.constantFrom(...konton),
            fc.integer({ min: -1_000_000, max: 1_000_000 }),
          ),
          { maxLength: 30 },
        ),
        (rader) => {
          const bokslut = beraknaForenkladArsbokslut(
            bokforOre(
              rader.map(([debet, kredit, belopp]) => [debet, kredit, ore(belopp)]),
            ),
          );
          expect(bokslut.differens).toBe(ZERO);
          expect(bokslut.resultatdifferens).toBe(ZERO);
          expect(bokslut.kontonUtanRuta).toEqual([]);
        },
      ),
    );
  });
});
