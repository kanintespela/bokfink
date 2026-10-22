import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import { kontonummer, skapaKonto, type Konto, type Kontonummer } from '../konto/konto';
import type { Uuid } from '../id/uuidv7';
import { skapaRakenskapsar } from '../rakenskapsar/rakenskapsar';
import { datum } from '../tid/datum';
import { verifikatserie } from '../verifikat/serie';
import { bokfor, skapaUtkast, type BokfortVerifikat } from '../verifikat/verifikat';
import {
  kostnadsfordelning,
  likvidaMedel,
  likviditetPerManad,
  momsskuld,
  resultatPerManad,
} from './nyckeltal';
import { beraknaSaldon } from './saldon';

const kr = (text: string) => oreFromKronor(text);

const KONTON: ReadonlyMap<Kontonummer, Konto> = new Map(
  [
    ['1930', 'Företagskonto'],
    ['2013', 'Egna insättningar och uttag'],
    ['2611', 'Utgående moms 25 %'],
    ['2640', 'Ingående moms'],
    ['3010', 'Försäljning'],
    ['4010', 'Inköp av material och varor'],
    ['5611', 'Drivmedel'],
    ['6110', 'Kontorsmateriel'],
  ].map(([nummer, namn]) => [
    kontonummer(nummer!),
    skapaKonto({ nummer: nummer!, namn: namn! }),
  ]),
);

const AR = skapaRakenskapsar({
  id: '019b76da-a800-7000-8000-000000002026' as Uuid,
  start: datum('2026-01-01'),
  slut: datum('2026-12-31'),
  // Opening balances have to balance, which the domain insists on: 5 000 in
  // the bank against 5 000 of own capital.
  ingaendeBalanser: [
    { konto: kontonummer('1930'), belopp: kr('5000.00') },
    { konto: kontonummer('2013'), belopp: kr('-5000.00') },
  ],
});

let raknare = 0;

function verifikat(
  datumtext: string,
  rader: readonly (readonly [string, string])[],
): BokfortVerifikat {
  raknare += 1;
  return bokfor(
    skapaUtkast({
      id: `019b76da-a800-7000-8000-${String(raknare).padStart(12, '0')}` as Uuid,
      datum: datum(datumtext),
      beskrivning: 'test',
      konteringar: rader.map(([konto, belopp]) => ({
        konto: kontonummer(konto),
        belopp: kr(belopp),
      })),
    }),
    {
      serie: verifikatserie('A'),
      nummer: raknare,
      bokfortDatum: datum(datumtext),
      kalla: 'manuell',
    },
  );
}

/*
 * Two months of a small year: a sale in February and three costs in March.
 *
 *   feb  sale 12 500 incl. 2 500 VAT      result +10 000   bank 17 500
 *   mar  fuel 1 250 incl. 250 VAT         result  -1 000   bank 16 250
 *   mar  supplies 500 incl. 100 VAT       result    -400   bank 15 750
 *   mar  materials 1 000 incl. 200 VAT    result    -800   bank 14 750
 */
const HANDELSER = [
  verifikat('2026-02-13', [
    ['1930', '12500.00'],
    ['3010', '-10000.00'],
    ['2611', '-2500.00'],
  ]),
  verifikat('2026-03-05', [
    ['5611', '1000.00'],
    ['2640', '250.00'],
    ['1930', '-1250.00'],
  ]),
  verifikat('2026-03-20', [
    ['6110', '400.00'],
    ['2640', '100.00'],
    ['1930', '-500.00'],
  ]),
  verifikat('2026-03-28', [
    ['4010', '800.00'],
    ['2640', '200.00'],
    ['1930', '-1000.00'],
  ]),
];

describe('resultatPerManad', () => {
  const serie = resultatPerManad(AR, HANDELSER);

  it('gives each month of the year its own figure', () => {
    expect(serie).toHaveLength(12);
    expect(serie[0]).toEqual({ manad: '2026-01', belopp: 0 });
    expect(serie[1]).toEqual({ manad: '2026-02', belopp: kr('10000.00') });
    // 1 000 of fuel, 400 of supplies and 800 of materials.
    expect(serie[2]).toEqual({ manad: '2026-03', belopp: kr('-2200.00') });
  });

  /*
   * Each month on its own rather than accumulated. A rising line of totals
   * hides which months carried the year, which is the whole question.
   */
  it('does not accumulate', () => {
    expect(serie[3]?.belopp).toBe(0);
  });
});

describe('likviditetPerManad', () => {
  it('carries everything before it, because a balance is a position', () => {
    const serie = likviditetPerManad(AR, HANDELSER);

    expect(serie[0]?.belopp).toBe(kr('5000.00'));
    expect(serie[1]?.belopp).toBe(kr('17500.00'));
    // 17 500 less 1 250, 500 and 1 000.
    expect(serie[2]?.belopp).toBe(kr('14750.00'));
    expect(serie[11]?.belopp).toBe(kr('14750.00'));
  });
});

describe('momsskuld', () => {
  /*
   * 2 500 charged on the sale, 550 paid on the purchases. Positive is what is
   * owed to Skatteverket, which is what the word means outside a ledger.
   */
  it('is what is owed, not the sign the ledger stores', () => {
    const saldon = beraknaSaldon(AR.ingaendeBalanser, HANDELSER);
    expect(momsskuld(saldon)).toBe(kr('1950.00'));
  });

  it('is negative when the money is coming back', () => {
    const bara = beraknaSaldon([], [HANDELSER[1]!]);
    expect(momsskuld(bara)).toBe(kr('-250.00'));
  });
});

describe('likvidaMedel', () => {
  it('is what the bank and the till hold', () => {
    expect(likvidaMedel(beraknaSaldon(AR.ingaendeBalanser, HANDELSER))).toBe(
      kr('14750.00'),
    );
  });
});

describe('kostnadsfordelning', () => {
  const saldon = beraknaSaldon(AR.ingaendeBalanser, HANDELSER);

  it('lists what the money went to, largest first', () => {
    expect(kostnadsfordelning(saldon, KONTON)).toEqual([
      { konto: kontonummer('5611'), namn: 'Drivmedel', belopp: kr('1000.00') },
      {
        konto: kontonummer('4010'),
        namn: 'Inköp av material och varor',
        belopp: kr('800.00'),
      },
      { konto: kontonummer('6110'), namn: 'Kontorsmateriel', belopp: kr('400.00') },
    ]);
  });

  /*
   * A chart whose parts do not add up to the whole is a chart that lies, so
   * the tail is gathered rather than dropped.
   */
  it('gathers the tail instead of dropping it', () => {
    const fordelning = kostnadsfordelning(saldon, KONTON, 2);

    expect(fordelning).toHaveLength(2);
    expect(fordelning[1]).toEqual({
      konto: '',
      namn: 'Övriga 2 konton',
      belopp: kr('1200.00'),
    });
    const summa = fordelning.reduce((total, post) => total + post.belopp, 0);
    expect(summa).toBe(kr('2200.00'));
  });

  it('leaves out income and accounts that did not move', () => {
    const konton = kostnadsfordelning(saldon, KONTON).map((post) => post.konto);
    expect(konton).not.toContain(kontonummer('3010'));
    expect(konton).not.toContain(kontonummer('1930'));
  });
});
