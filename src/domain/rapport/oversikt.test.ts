import { describe, expect, it } from 'vitest';

import { add, oreFromKronor, subtract } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import { kontonummer, skapaKonto, type Konto, type Kontonummer } from '../konto/konto';
import { skapaRakenskapsar } from '../rakenskapsar/rakenskapsar';
import { datum } from '../tid/datum';
import { verifikatserie } from '../verifikat/serie';
import { bokfor, skapaUtkast, type BokfortVerifikat } from '../verifikat/verifikat';
import { beraknaOversikt, sammaDagIFjol } from './oversikt';

const kr = (text: string) => oreFromKronor(text);

const KONTON: ReadonlyMap<Kontonummer, Konto> = new Map(
  [
    ['1930', 'Företagskonto'],
    ['2013', 'Egna insättningar och uttag'],
    ['2611', 'Utgående moms 25 %'],
    ['2640', 'Ingående moms'],
    ['3010', 'Försäljning'],
    ['5611', 'Drivmedel'],
  ]
    .map(([nummer, namn]) => skapaKonto({ nummer: nummer!, namn: namn! }))
    .concat(skapaKonto({ nummer: '8310', namn: 'Ränteintäkter', typ: 'intakt' }))
    .map((konto) => [konto.nummer, konto]),
);

const AR_2025 = skapaRakenskapsar({
  id: '019b76da-a800-7000-8000-000000002025' as Uuid,
  start: datum('2025-01-01'),
  slut: datum('2025-12-31'),
  ingaendeBalanser: [],
});

const AR_2026 = skapaRakenskapsar({
  id: '019b76da-a800-7000-8000-000000002026' as Uuid,
  start: datum('2026-01-01'),
  slut: datum('2026-12-31'),
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
 * Facit, by hand:
 *
 *   2025-03-10  sale 1 250 incl. 250 moms      in time for "last year to date"
 *   2025-12-01  sale 2 500 incl. 500 moms      after 17 November: not compared
 *   2026-02-10  sale 12 500 incl. 2 500 moms   intäkter 10 000
 *   2026-03-05  fuel 1 250 incl. 250 moms      kostnader 1 000
 *   2026-06-30  interest 40                    finansiella poster +40
 *
 *   2026 to 17 Nov:  10 000 - 1 000 + 40 = 9 040 result
 *                    bank 5 000 + 12 500 - 1 250 + 40 = 16 290
 *                    moms 2 500 - 250 = 2 250 to pay
 *   2025 to 17 Nov:  intäkter 1 000, result 1 000, bank 1 250
 */
const VERIFIKAT = [
  verifikat('2025-03-10', [
    ['1930', '1250.00'],
    ['3010', '-1000.00'],
    ['2611', '-250.00'],
  ]),
  verifikat('2025-12-01', [
    ['1930', '2500.00'],
    ['3010', '-2000.00'],
    ['2611', '-500.00'],
  ]),
  verifikat('2026-02-10', [
    ['1930', '12500.00'],
    ['3010', '-10000.00'],
    ['2611', '-2500.00'],
  ]),
  verifikat('2026-03-05', [
    ['5611', '1000.00'],
    ['2640', '250.00'],
    ['1930', '-1250.00'],
  ]),
  verifikat('2026-06-30', [
    ['1930', '40.00'],
    ['8310', '-40.00'],
  ]),
];

describe('beraknaOversikt', () => {
  const oversikt = beraknaOversikt(
    AR_2026,
    [AR_2025, AR_2026],
    VERIFIKAT,
    KONTON,
    datum('2026-11-17'),
  );

  it('sums the year so far the way the resultaträkning does', () => {
    expect(oversikt.till).toBe('2026-11-17');
    expect(oversikt.iAr).toEqual({
      intakter: kr('10000.00'),
      kostnader: kr('1000.00'),
      finansiellaPoster: kr('40.00'),
      resultat: kr('9040.00'),
      likvida: kr('16290.00'),
    });
    expect(oversikt.moms).toBe(kr('2250.00'));
    const { intakter, kostnader, finansiellaPoster, resultat } = oversikt.iAr;
    expect(add(subtract(intakter, kostnader), finansiellaPoster)).toBe(resultat);
  });

  /* A year still running is compared with the same stretch of last year, not all of it. */
  it('compares with last year up to the same day', () => {
    expect(oversikt.ifjol?.till).toBe('2025-11-17');
    expect(oversikt.ifjol?.tal).toEqual({
      intakter: kr('1000.00'),
      kostnader: kr('0.00'),
      finansiellaPoster: kr('0.00'),
      resultat: kr('1000.00'),
      likvida: kr('1250.00'),
    });
  });

  it('draws only the months that have begun', () => {
    expect(oversikt.resultatPerManad.map((varde) => varde.manad)).toHaveLength(11);
    expect(oversikt.likviditetPerManad.at(-1)).toEqual({
      manad: '2026-11',
      belopp: kr('16290.00'),
    });
    expect(oversikt.kostnader).toEqual([
      { konto: '5611', namn: 'Drivmedel', belopp: kr('1000.00') },
    ]);
  });

  it('takes a past year whole, and has nothing to compare the first with', () => {
    const fjol = beraknaOversikt(
      AR_2025,
      [AR_2025, AR_2026],
      VERIFIKAT,
      KONTON,
      datum('2026-11-17'),
    );
    expect(fjol.till).toBe('2025-12-31');
    expect(fjol.iAr.intakter).toBe(kr('3000.00'));
    expect(fjol.ifjol).toBeUndefined();
    expect(fjol.resultatPerManad).toHaveLength(12);
  });
});

describe('sammaDagIFjol', () => {
  it('moves the day back a year, and a leap day to the 28th', () => {
    const ar2028 = { ...AR_2026, start: datum('2028-01-01'), slut: datum('2028-12-31') };
    const ar2027 = { ...AR_2026, start: datum('2027-01-01'), slut: datum('2027-12-31') };
    expect(sammaDagIFjol(datum('2028-02-29'), ar2028, ar2027)).toBe('2027-02-28');
    expect(sammaDagIFjol(datum('2026-11-17'), AR_2026, AR_2025)).toBe('2025-11-17');
  });

  it('stops at the end of a shortened year before', () => {
    const kort = { ...AR_2025, start: datum('2025-07-01'), slut: datum('2025-10-31') };
    expect(sammaDagIFjol(datum('2026-11-17'), AR_2026, kort)).toBe('2025-10-31');
  });
});
