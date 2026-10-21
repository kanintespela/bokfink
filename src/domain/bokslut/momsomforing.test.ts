import { describe, expect, it } from 'vitest';

import { oreFromKronor, ZERO, type Ore } from '../belopp/ore';
import { beraknaForenkladArsbokslut } from './forenkladArsbokslut';
import { kontonummer, type Kontonummer } from '../konto/konto';
import type { Kontosaldo } from '../rapport/saldon';
import { foreslaMomsomforing, momsomforingskonteringar } from './momsomforing';

const kr = (text: string): Ore => oreFromKronor(text);

const saldon = (...poster: readonly (readonly [string, string])[]) =>
  new Map<Kontonummer, Kontosaldo>(
    poster.map(([konto, belopp]) => [
      kontonummer(konto),
      {
        konto: kontonummer(konto),
        ingaende: ZERO,
        forandring: kr(belopp),
        utgaende: kr(belopp),
      },
    ]),
  );

describe('foreslaMomsomforing', () => {
  it('föreslår en omföring när 2650 står på debet, alltså är en fordran', () => {
    // 1 875 kr som Skatteverket är skyldig näringsidkaren.
    expect(foreslaMomsomforing(saldon(['2650', '1875']))).toEqual({
      fran: kontonummer('2650'),
      till: kontonummer('1650'),
      belopp: kr('1875'),
    });
  });

  it('rör inte en momsskuld, som ska ligga kvar', () => {
    expect(foreslaMomsomforing(saldon(['2650', '-4500']))).toBeUndefined();
  });

  it('föreslår ingenting vid nollsaldo eller utan kontot alls', () => {
    expect(foreslaMomsomforing(saldon(['2650', '0']))).toBeUndefined();
    expect(foreslaMomsomforing(saldon(['1930', '1000']))).toBeUndefined();
  });

  it('går att peka på andra konton, för en kontoplan som numrerar annorlunda', () => {
    const eget = foreslaMomsomforing(
      saldon(['2651', '100']),
      kontonummer('2651'),
      kontonummer('1651'),
    );
    expect(eget?.till).toBe(kontonummer('1651'));
  });
});

describe('momsomforingskonteringar', () => {
  it('debiterar fordran och krediterar skuldkontot, och balanserar', () => {
    const konteringar = momsomforingskonteringar({
      fran: kontonummer('2650'),
      till: kontonummer('1650'),
      belopp: kr('1875'),
    });
    expect(konteringar).toEqual([
      { konto: kontonummer('1650'), belopp: kr('1875') },
      { konto: kontonummer('2650'), belopp: kr('-1875') },
    ]);
    expect(konteringar.reduce((summa, rad) => summa + rad.belopp, 0)).toBe(0);
  });

  /*
   * Vad omföringen är till för: rutan byter sida på blanketten, eget kapital
   * står stilla. Ett års bokslut i miniatyr - tillgångar 258 732,15, moms
   * 1 875 på 2650, eget kapital 260 607,15.
   */
  it('flyttar beloppet från B14 till B8 utan att röra B10', () => {
    const fore = beraknaForenkladArsbokslut(
      saldon(['1930', '258732.15'], ['2650', '1875'], ['2010', '-260607.15']),
    );
    expect(fore.rutor.get('B14')?.belopp).toBe(kr('-1875'));
    expect(fore.rutor.get('B8')).toBeUndefined();

    const efter = beraknaForenkladArsbokslut(
      saldon(['1930', '258732.15'], ['1650', '1875'], ['2010', '-260607.15']),
    );
    expect(efter.rutor.get('B8')?.belopp).toBe(kr('1875'));
    expect(efter.rutor.get('B14')).toBeUndefined();

    expect(efter.rutor.get('B10')?.belopp).toBe(fore.rutor.get('B10')?.belopp);
    expect(efter.summaTillgangar).toBe(kr('260607.15'));
    expect(efter.differens).toBe(ZERO);
  });
});
