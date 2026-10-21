import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { add, negate, ore, oreFromKronor, ZERO, type Ore } from '../belopp/ore';
import { beraknaForenkladArsbokslut } from '../bokslut/forenkladArsbokslut';
import { kontonummer, type Kontonummer } from '../konto/konto';
import type { Kontosaldo } from '../rapport/saldon';
import { avrundaTillHelKrona, beraknaNebilaga, type Nerad } from './nebilaga';

const kr = (text: string): Ore => oreFromKronor(text);

function bokfor(
  rader: readonly (readonly [debet: string, kredit: string, belopp: Ore])[],
): Map<Kontonummer, Kontosaldo> {
  const saldon = new Map<Kontonummer, Kontosaldo>();
  const flytta = (konto: string, belopp: Ore) => {
    const k = kontonummer(konto);
    const utgaende = add(saldon.get(k)?.utgaende ?? ZERO, belopp);
    saldon.set(k, { konto: k, ingaende: ZERO, forandring: utgaende, utgaende });
  };
  for (const [debet, kredit, belopp] of rader) {
    flytta(debet, belopp);
    flytta(kredit, negate(belopp));
  }
  return saldon;
}

const falt = (rader: readonly Nerad[]) =>
  Object.fromEntries(rader.map((rad) => [rad.rad, rad.belopp]));

describe('avrundaTillHelKrona', () => {
  it('avrundar till närmaste krona, halva kronor bort från noll', () => {
    expect(avrundaTillHelKrona(kr('2087.49'))).toBe(kr('2087'));
    expect(avrundaTillHelKrona(kr('2087.50'))).toBe(kr('2088'));
    expect(avrundaTillHelKrona(kr('-2912.50'))).toBe(kr('-2913'));
    expect(avrundaTillHelKrona(kr('-2912.49'))).toBe(kr('-2912'));
    expect(avrundaTillHelKrona(kr('100'))).toBe(kr('100'));
  });

  it('ger noll utan tecken, aldrig -0', () => {
    expect(Object.is(avrundaTillHelKrona(kr('-0.40')), 0)).toBe(true);
    expect(avrundaTillHelKrona(ZERO)).toBe(ZERO);
  });
});

describe('beraknaNebilaga', () => {
  /*
   * Handräknat, med ören som avrundas åt båda hållen:
   *   1930 bank:  40 000,40 + 60 000,60 + 15 000,15 - 20 000,30 - 5 000,08
   *               = 90 000,77                            → B9  90 001
   *   1110:       80 000,00                              → B2  80 000
   *   2610/2640:  15 000,15 - 5 000,08 = 10 000,07       → B14 10 000
   *   3010:       60 000,60                              → R1  60 001
   *   4010:       20 000,30                              → R5  20 000
   *   R11 = 60 001 - 20 000 = 40 001        (exakt 40 000,30)
   *   B10 = 90 001 + 80 000 - 10 000 = 160 001
   *         (exakt 2010:s 120 000,40 + resultatet 40 000,30 = 160 000,70)
   */
  const saldon = bokfor([
    ['1930', '2010', kr('40000.40')],
    ['1110', '2010', kr('80000.00')],
    ['1930', '3010', kr('60000.60')],
    ['1930', '2610', kr('15000.15')],
    ['4010', '1930', kr('20000.30')],
    ['2640', '1930', kr('5000.08')],
  ]);
  const bokslut = beraknaForenkladArsbokslut(saldon);

  it('avrundar varje ruta på sidan 1 och räknar B10 och R11 ur de avrundade', () => {
    const ne = beraknaNebilaga(bokslut, {});
    const sida1 = falt(ne.sida1);

    expect(sida1).toEqual({
      B2: kr('80000'),
      B9: kr('90001'),
      B10: kr('160001'),
      B14: kr('10000'),
      R1: kr('60001'),
      R5: kr('20000'),
      R11: kr('40001'),
    });
    // 160 001 mot exakt 160 000,70, och 40 001 mot exakt 40 000,30.
    expect(ne.avrundningB10).toBe(kr('0.30'));
    expect(ne.avrundningR11).toBe(kr('0.70'));
    expect(ne.hinder).toEqual([]);
  });

  it('bär med fältkoderna för SRU-filen, i blankettens ordning', () => {
    const ne = beraknaNebilaga(bokslut, {});
    expect(ne.sida1.map((rad) => rad.faltkod)).toEqual([
      '7210',
      '7280',
      '7300',
      '7381',
      '7400',
      '7500',
      '7440',
    ]);
  });

  it('för över R11 till R12 och ger överskottet i R47', () => {
    const ne = beraknaNebilaga(bokslut, { R13: kr('1500') });
    expect(falt(ne.sida2)).toEqual({
      R12: kr('40001'),
      R13: kr('1500'),
      // 40 001 + 1 500
      R47: kr('41501'),
    });
    expect(ne.sida2.find((rad) => rad.rad === 'R47')?.faltkod).toBe('7630');
    expect(ne.resultat).toBe(kr('41501'));
  });

  it('ger underskottet i R48 som ett positivt belopp, med fjolårets underskott i R24', () => {
    // Årets resultat 40 001, fjolårets outnyttjade underskott 76 579.
    const ne = beraknaNebilaga(bokslut, { R24: kr('76579') });
    expect(ne.resultat).toBe(kr('-36578'));
    expect(falt(ne.sida2)).toEqual({
      R12: kr('40001'),
      R24: kr('76579'),
      R48: kr('36578'),
    });
    expect(ne.sida2.find((rad) => rad.rad === 'R48')?.faltkod).toBe('7730');
  });

  it('följer blankettens tecken för varje justering', () => {
    // + R15 1 000, - R16 400, - R22 100, + R23 50, + R32 2 000, - R43 3 000,
    // + R44 10: 40 001 + 1 000 - 400 - 100 + 50 + 2 000 - 3 000 + 10 = 39 561
    const ne = beraknaNebilaga(bokslut, {
      R15: kr('1000'),
      R16: kr('400'),
      R22: kr('100'),
      R23: kr('50'),
      R32: kr('2000'),
      R43: kr('3000'),
      R44: kr('10'),
    });
    expect(ne.resultat).toBe(kr('39561'));
  });

  it('godtar periodiseringsfond upp till exakt 30 % av R33, inte en krona mer', () => {
    // R33 = 40 001; 30 % = 12 000,30, så 12 000 går och 12 001 går inte.
    expect(beraknaNebilaga(bokslut, { R34: kr('12000') }).hinder).toEqual([]);
    expect(beraknaNebilaga(bokslut, { R34: kr('12001') }).hinder).toEqual([
      'R34 får vara högst 30 % av överskottet i R33.',
    ]);
  });

  it('vägrar räntefördelning och expansionsfond större än överskottet', () => {
    expect(beraknaNebilaga(bokslut, { R24: kr('50000'), R30: kr('1') }).hinder).toEqual([
      'R30 får vara högst överskottet i R29.',
    ]);
    expect(beraknaNebilaga(bokslut, { R36: kr('40002') }).hinder).toEqual([
      'R36 får vara högst överskottet i R35.',
    ]);
    expect(beraknaNebilaga(bokslut, { R36: kr('40001') }).hinder).toEqual([]);
  });

  it('vägrar ören och negativa belopp där fältet inte tillåter dem', () => {
    expect(beraknaNebilaga(bokslut, { R13: kr('10.50') }).hinder).toEqual([
      'R13 ska anges i hela kronor.',
    ]);
    expect(beraknaNebilaga(bokslut, { R13: kr('-10') }).hinder).toEqual([
      'R13 kan inte vara negativt.',
    ]);
    // R41 är Numeriskt_A: ett slutskattebesked kan sätta ned egenavgifterna.
    expect(beraknaNebilaga(bokslut, { R41: kr('-10') }).hinder).toEqual([]);
  });

  it('räknar inte en bilaga ur ett årsbokslut som inte är färdigt', () => {
    const ofardigt = beraknaForenkladArsbokslut(
      bokfor([
        ['1930', '3740', kr('0.40')],
        ['1810', '1930', kr('100')],
      ]),
    );
    expect(beraknaNebilaga(ofardigt, {}).hinder).toEqual([
      'Välj ruta för konto 3740 i årsbokslutet.',
      'Konto 1810 har saldo men ingen ruta i årsbokslutet.',
      'Årsbokslutets balansräkning går inte ihop.',
      'Årsbokslutets resultat skiljer sig från bokföringens.',
    ]);
  });

  /*
   * The invariant the rounding rests on: whatever the öre, page 1 adds up -
   * B1-B9 equal B10 plus B13-B16, and R11 is R1-R4 less R5-R10 - because
   * B10 and R11 are worked out from the rounded boxes as the form says.
   */
  it('går ihop på sidan 1 för varje bokföring, hur örena än faller', () => {
    const konton = [
      '1110',
      '1220',
      '1400',
      '1930',
      '2010',
      '2013',
      '2350',
      '2440',
      '2610',
      '2640',
      '3010',
      '3100',
      '4010',
      '5410',
      '6981',
      '7820',
      '8410',
    ];
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom(...konton),
            fc.constantFrom(...konton),
            fc.integer({ min: -10_000_000, max: 10_000_000 }),
          ),
          { maxLength: 25 },
        ),
        (rader) => {
          const ne = beraknaNebilaga(
            beraknaForenkladArsbokslut(
              bokfor(rader.map(([d, k, belopp]) => [d, k, ore(belopp)])),
            ),
            {},
          );
          const f = falt(ne.sida1);
          const v = (rad: string): number => f[rad] ?? 0;
          const tillgangar = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9'];
          const skulder = ['B10', 'B13', 'B14', 'B15', 'B16'];
          const sum = (r: string[]) => r.reduce((a, rad) => a + v(rad), 0);
          expect(sum(tillgangar)).toBe(sum(skulder));
          expect(v('R11')).toBe(
            sum(['R1', 'R2', 'R3', 'R4']) - sum(['R5', 'R6', 'R7', 'R8', 'R9', 'R10']),
          );
          for (const rad of ne.sida1) {
            expect(rad.belopp % 100 === 0).toBe(true);
          }
        },
      ),
    );
  });
});
