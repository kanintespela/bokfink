import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { add, negate, oreFromKronor, ZERO, type Ore } from '../belopp/ore';
import { beraknaForenkladArsbokslut } from '../bokslut/forenkladArsbokslut';
import { kodaLatin1 } from '../export/latin1';
import { kontonummer, type Kontonummer } from '../konto/konto';
import type { Kontosaldo } from '../rapport/saldon';
import { beraknaNebilaga } from '../skatt/nebilaga';
import { datum } from '../tid/datum';
import {
  beskattningsperiod,
  kontrolleratPersonnummer,
  skrivNeSru,
  SruError,
  type Sruuppgifter,
} from './sru';

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

/*
 * A small year with a loss, a momsfordran on 2650 (a negative B14, which the
 * field allows) and last year's underskott brought forward in R24.
 * Handräknat:
 *   B2  1110 80 000 - 1119 3 109,36 = 76 890,64          → 76 891
 *   B9  20 000 + 4 000 + 1 000 - 9 000,40 - 2 250,10
 *       = 13 749,50                                      → 13 750
 *   B14 26xx: 2610 -2 000, 2650 +3 250,10 = 1 250,10 debet → -1 250
 *   R1 4 000, R5 9 000,40 → 9 000, R9 3 109,36 → 3 109
 *   R11 = 4 000 - 9 000 - 3 109 = -8 109
 *   B10 = 76 891 + 13 750 - (-1 250) = 91 891
 *   R48 = -8 109 - 35 565 = -43 674, skrivet som 43 674 i 7730
 */
const bokslut = beraknaForenkladArsbokslut(
  bokfor([
    ['1930', '2010', kr('20000')],
    ['1110', '2010', kr('80000')],
    ['1930', '3010', kr('4000')],
    ['1930', '2610', kr('1000')],
    ['4010', '1930', kr('9000.40')],
    ['2640', '1930', kr('2250.10')],
    ['2650', '2610', kr('1000')],
    ['2640', '2650', kr('-2250.10')],
    ['7820', '1119', kr('3109.36')],
  ]),
);
const ne = beraknaNebilaga(bokslut, { R24: kr('35565') });

// Skatteverket's own test personnummer, 19121212-1212, passes the Luhn check.
const UPPGIFTER: Sruuppgifter = {
  deklarant: {
    personnummer: '19121212-1212',
    namn: 'Test Testsson',
    adress: 'Gården 1',
    postnummer: '123 45',
    postort: 'Ekeby',
  },
  rakenskapsar: { start: datum('2025-01-01'), slut: datum('2025-12-31') },
  verksamhetensArt: 'Fårskötsel',
  ne,
  skapad: { datum: datum('2026-03-15'), tid: '101500' },
  program: 'Bokfink',
};

const fixtur = (namn: string) =>
  readFileSync(new URL(`./__fixtures__/ne-2025p4/${namn}`, import.meta.url));

describe('skrivNeSru', () => {
  /*
   * Golden files. They were written by this code and then read line by line
   * against the fältnamnstabell NE_SKV2161-13-02-25-02 and the file example
   * in the 2025P4 package; a change to them has to be explained in the
   * commit that makes it.
   */
  it('skriver INFO.SRU och BLANKETTER.SRU byte för byte som referensfilerna', () => {
    const filer = skrivNeSru(UPPGIFTER);
    expect(Buffer.from(kodaLatin1(filer.info))).toEqual(fixtur('INFO.SRU'));
    expect(Buffer.from(kodaLatin1(filer.blanketter))).toEqual(fixtur('BLANKETTER.SRU'));
  });

  it('skriver underskottet som ett positivt belopp i 7730 och negativa rutor med minustecken', () => {
    const { blanketter } = skrivNeSru(UPPGIFTER);
    expect(blanketter).toContain('#UPPGIFT 7730 ');
    expect(blanketter).not.toContain('#UPPGIFT 7630 ');
    expect(blanketter).toMatch(/#UPPGIFT 7381 -\d+\r\n/);
  });

  it('vägrar skriva en bilaga med hinder', () => {
    const ofardig = beraknaNebilaga(
      beraknaForenkladArsbokslut(bokfor([['1930', '3740', kr('1')]])),
      {},
    );
    expect(() => skrivNeSru({ ...UPPGIFTER, ne: ofardig })).toThrow(SruError);
  });

  it('vägrar ett år vars blankett Bokfink inte känner till', () => {
    expect(() =>
      skrivNeSru({
        ...UPPGIFTER,
        rakenskapsar: { start: datum('2026-01-01'), slut: datum('2026-12-31') },
      }),
    ).toThrow(/2026P4/);
  });

  it('kräver postnummer, postort och namn', () => {
    const med = (andring: Partial<Sruuppgifter['deklarant']>) => () =>
      skrivNeSru({ ...UPPGIFTER, deklarant: { ...UPPGIFTER.deklarant, ...andring } });
    expect(med({ postnummer: '3643' })).toThrow(SruError);
    expect(med({ postort: '  ' })).toThrow(SruError);
    expect(med({ namn: '' })).toThrow(SruError);
  });

  it('lämnar bort adress och verksamhetens art när de saknas', () => {
    const filer = skrivNeSru({
      ...UPPGIFTER,
      deklarant: { ...UPPGIFTER.deklarant, adress: '' },
      verksamhetensArt: '',
    });
    expect(filer.info).not.toContain('#ADRESS');
    expect(filer.blanketter).not.toContain('#UPPGIFT 7020');
  });
});

describe('beskattningsperiod', () => {
  it('är P4 för det kalenderår räkenskapsåret slutar', () => {
    expect(beskattningsperiod(datum('2025-12-31'))).toBe('2025P4');
  });

  it('vägrar ett brutet räkenskapsår', () => {
    expect(() => beskattningsperiod(datum('2025-06-30'))).toThrow(SruError);
  });
});

describe('kontrolleratPersonnummer', () => {
  it('godtar tolv siffror med rätt kontrollsiffra, med eller utan bindestreck', () => {
    expect(kontrolleratPersonnummer('19121212-1212')).toBe('191212121212');
    expect(kontrolleratPersonnummer('191212121212')).toBe('191212121212');
  });

  it('vägrar tio siffror, eftersom seklet inte går att veta', () => {
    expect(() => kontrolleratPersonnummer('121212-1212')).toThrow(/tolv siffror/);
  });

  it('vägrar fel kontrollsiffra', () => {
    expect(() => kontrolleratPersonnummer('191212121213')).toThrow(/kontrollsiffra/);
  });
});
