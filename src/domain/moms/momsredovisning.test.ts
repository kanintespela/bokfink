import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import { kontonummer } from '../konto/konto';
import { datum } from '../tid/datum';
import { verifikatserie } from '../verifikat/serie';
import { bokfor, skapaUtkast, type BokfortVerifikat } from '../verifikat/verifikat';
import { arMomsavrakning } from './momsrapport';
import { MomsredovisningFinnsError, momsredovisning } from './momsredovisning';

let raknare = 0;

function verifikat(
  datumtext: string,
  rader: readonly (readonly [string, string])[],
): BokfortVerifikat {
  raknare += 1;
  return bokfor(
    skapaUtkast({
      id: `01990000-0000-7000-8000-${String(raknare).padStart(12, '0')}` as Uuid,
      datum: datum(datumtext),
      beskrivning: 'test',
      konteringar: rader.map(([konto, kronor]) => ({
        konto: kontonummer(konto),
        belopp: oreFromKronor(kronor),
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

const rader = (utkast: { konteringar: readonly { konto: string; belopp: number }[] }) =>
  Object.fromEntries(utkast.konteringar.map((rad) => [rad.konto, rad.belopp]));

const KV1_2025 = { fran: datum('2025-01-01'), till: datum('2025-03-31') };

/*
 * Facit, worked out by hand for the quarter, dated 2025-03-31:
 *
 *   2610   2 528,98   utgående moms emptied
 *   2640  -1 205,97   ingående moms emptied
 *   2650  -1 323,00   box 49: 2 528 - 1 205, to pay, so a skuld
 *   3740      -0,01   the öre the boxes dropped: 2 528,98 - 1 205,97 - 1 323
 */
describe('momsredovisning', () => {
  const forsaljning = verifikat('2025-02-10', [
    ['1930', '12645.00'],
    ['3010', '-10115.93'],
    ['2610', '-2528.98'],
    ['3740', '-0.09'],
  ]);
  const inkop = verifikat('2025-03-05', [
    ['4010', '4823.88'],
    ['2640', '1205.97'],
    ['2013', '-6029.85'],
  ]);

  it('empties the moms accounts into 2650 by box 49, with the öre on 3740', () => {
    const forslag = momsredovisning({ ...KV1_2025, verifikat: [forsaljning, inkop] });

    expect(forslag.datum).toBe('2025-03-31');
    expect(rader(forslag)).toEqual({
      2610: oreFromKronor('2528.98'),
      2640: oreFromKronor('-1205.97'),
      2650: oreFromKronor('-1323.00'),
      3740: oreFromKronor('-0.01'),
    });
  });

  /*
   * A quarter with more in than out:
   * 296,57 out and 728,88 in give box 49 = 296 - 728 = -432, money back.
   */
  it('puts a refund on 2650 as a fordran', () => {
    const forslag = momsredovisning({
      fran: datum('2025-07-01'),
      till: datum('2025-09-30'),
      verifikat: [
        verifikat('2025-08-01', [
          ['1930', '1482.84'],
          ['3010', '-1186.27'],
          ['2610', '-296.57'],
        ]),
        verifikat('2025-08-15', [
          ['4010', '2915.52'],
          ['2640', '728.88'],
          ['2013', '-3644.40'],
        ]),
      ],
    });

    expect(rader(forslag)).toEqual({
      2610: oreFromKronor('296.57'),
      2640: oreFromKronor('-728.88'),
      2650: oreFromKronor('432.00'),
      3740: oreFromKronor('0.31'),
    });
  });

  it('leaves out 3740 when the boxes dropped nothing', () => {
    const forslag = momsredovisning({
      ...KV1_2025,
      verifikat: [
        verifikat('2025-01-20', [
          ['5420', '800.00'],
          ['2640', '200.00'],
          ['1930', '-1000.00'],
        ]),
      ],
    });

    expect(rader(forslag)).toEqual({
      2640: oreFromKronor('-200.00'),
      2650: oreFromKronor('200.00'),
    });
  });

  it('does not count what lies outside the period', () => {
    const forslag = momsredovisning({
      ...KV1_2025,
      verifikat: [
        forsaljning,
        inkop,
        verifikat('2025-04-02', [
          ['4010', '800.00'],
          ['2640', '200.00'],
          ['1930', '-1000.00'],
        ]),
      ],
    });

    expect(rader(forslag)[2640]).toBe(oreFromKronor('-1205.97'));
  });

  it('refuses a period that has already been settled', () => {
    const avrakning = verifikat('2025-03-31', [
      ['2610', '2528.98'],
      ['2640', '-1205.97'],
      ['2650', '-1323.00'],
      ['3740', '-0.01'],
    ]);

    expect(() =>
      momsredovisning({ ...KV1_2025, verifikat: [forsaljning, inkop, avrakning] }),
    ).toThrow(MomsredovisningFinnsError);
  });

  it('says so when there is no moms to settle', () => {
    expect(() =>
      momsredovisning({
        ...KV1_2025,
        verifikat: [
          verifikat('2025-01-20', [
            ['6981', '500.00'],
            ['2013', '-500.00'],
          ]),
        ],
      }),
    ).toThrow('Ingen moms');
  });

  /*
   * Nothing to pay and nothing back still empties the accounts, and the 2650
   * line stays at zero: it is what marks the entry as the period's
   * settlement, so the report keeps leaving it out.
   */
  it('keeps a zero line on 2650 when out and in cancel', () => {
    const forslag = momsredovisning({
      ...KV1_2025,
      verifikat: [
        verifikat('2025-02-01', [
          ['1930', '500.00'],
          ['3010', '-400.00'],
          ['2610', '-100.00'],
        ]),
        verifikat('2025-02-02', [
          ['4010', '400.00'],
          ['2640', '100.00'],
          ['1930', '-500.00'],
        ]),
      ],
    });

    expect(rader(forslag)[2650]).toBe(0);
    expect(arMomsavrakning(forslag.konteringar)).toBe(true);
  });

  it('always balances', () => {
    const forslag = momsredovisning({ ...KV1_2025, verifikat: [forsaljning, inkop] });
    expect(forslag.konteringar.reduce((summa, rad) => summa + rad.belopp, 0)).toBe(0);
  });
});
