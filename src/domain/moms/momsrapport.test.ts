import { describe, expect, it } from 'vitest';

import { kronorString, ore, oreFromKronor } from '../belopp/ore';
import { kontonummer } from '../konto/konto';
import { datum } from '../tid/datum';
import type { Uuid } from '../id/uuidv7';
import { verifikatserie } from '../verifikat/serie';
import { bokfor, skapaUtkast, type BokfortVerifikat } from '../verifikat/verifikat';
import {
  beraknaMomsrapport,
  harEuForsaljning,
  krontal,
  arMomsavrakning,
  paverkarMomsdeklarationen,
  ruta,
} from './momsrapport';

let raknare = 0;
const nyttId = () =>
  `019b76da-a800-7000-8000-${String((raknare += 1)).padStart(12, '0')}` as Uuid;

function verifikat(
  datumtext: string,
  rader: readonly (readonly [string, string])[],
  beskrivning = 'test',
): BokfortVerifikat {
  return bokfor(
    skapaUtkast({
      id: nyttId(),
      datum: datum(datumtext),
      beskrivning,
      konteringar: rader.map(([konto, kronor]) => ({
        konto: kontonummer(konto),
        belopp: oreFromKronor(kronor),
      })),
    }),
    {
      serie: verifikatserie('A'),
      nummer: (raknare += 1),
      bokfortDatum: datum(datumtext),
      kalla: 'manuell',
    },
  );
}

/**
 * Öre as the decimal string the fixtures are written in.
 *
 * Through kronorString rather than a division, so that not even the test
 * scaffolding puts an amount through a float.
 */
const kr = (belopp: number) => kronorString(ore(belopp));

const kvartal = (ar: number, kv: number) => ({
  fran: datum(`${ar}-${String(kv * 3 - 2).padStart(2, '0')}-01`),
  till: datum(`${ar}-${String(kv * 3).padStart(2, '0')}-${kv === 1 ? '31' : '30'}`),
});

describe('krontal', () => {
  /*
   * Skatteförfarandeförordning (2011:1261) 22 kap. 1 §: amounts are stated in whole
   * kronor "så att öretal faller bort". Dropping, not rounding - which is the
   * difference between 2 087 and 2 088 on a declaration.
   */
  it('drops the öre rather than rounding them', () => {
    expect(krontal(oreFromKronor('2087.57'))).toBe(oreFromKronor('2087.00'));
    expect(krontal(oreFromKronor('1821.99'))).toBe(oreFromKronor('1821.00'));
    expect(krontal(oreFromKronor('296.57'))).toBe(oreFromKronor('296.00'));
  });

  it('drops them towards zero for a refund as well', () => {
    expect(krontal(oreFromKronor('-2087.57'))).toBe(oreFromKronor('-2087.00'));
    expect(krontal(oreFromKronor('-0.99'))).toBe(0);
  });

  it('leaves whole kronor alone', () => {
    expect(krontal(oreFromKronor('1323.00'))).toBe(oreFromKronor('1323.00'));
    expect(krontal(ore(0))).toBe(0);
  });
});

describe('beraknaMomsrapport', () => {
  it('puts a domestic sale in boxes 05 and 10', () => {
    // Lamb sold for 12 645 kr including VAT, with 0,09 kr öresutjämning.
    const rapport = beraknaMomsrapport({
      ...kvartal(2025, 1),
      verifikat: [
        verifikat('2025-03-07', [
          ['1930', '12645.00'],
          ['2610', '-2528.98'],
          ['3010', '-10115.93'],
          ['3740', '-0.09'],
        ]),
      ],
    });

    expect(ruta(rapport, 5)).toBe(oreFromKronor('10115.00'));
    expect(ruta(rapport, 10)).toBe(oreFromKronor('2528.00'));
    expect(rapport.attBetala).toBe(oreFromKronor('2528.00'));
  });

  // A mower sold for 10 000 kr plus 2 500 kr moms, booked the K1 way.
  it('counts a sold inventarie on 1222 as a sale in box 05', () => {
    const rapport = beraknaMomsrapport({
      ...kvartal(2026, 2),
      verifikat: [
        verifikat('2026-05-04', [
          ['1930', '12500'],
          ['1222', '-10000'],
          ['2611', '-2500'],
        ]),
      ],
    });

    expect(ruta(rapport, 5)).toBe(oreFromKronor('10000'));
    expect(ruta(rapport, 10)).toBe(oreFromKronor('2500'));
  });

  it('leaves the year-end move of 1222 onto 1220 out of box 05', () => {
    const rapport = beraknaMomsrapport({
      ...kvartal(2026, 4),
      verifikat: [
        verifikat('2026-12-31', [
          ['1222', '10000'],
          ['1220', '-10000'],
        ]),
      ],
    });

    expect(ruta(rapport, 5)).toBe(0);
  });

  it('puts deductible VAT on a purchase in box 48', () => {
    const rapport = beraknaMomsrapport({
      ...kvartal(2025, 1),
      verifikat: [
        verifikat('2025-02-12', [
          ['2013', '-1351.88'],
          ['2640', '270.38'],
          ['5400', '1081.50'],
        ]),
      ],
    });

    expect(ruta(rapport, 48)).toBe(oreFromKronor('270.00'));
    expect(rapport.attBetala).toBe(oreFromKronor('-270.00'));
  });

  /*
   * Four quarters, each worked out by hand: a declaration takes whole kronor
   * in each box, so box 49 is the krona part of the outgoing VAT less the
   * krona part of the incoming. Quarter 1 is 2 528,98 out and 1 205,97 in,
   * 2 528 - 1 205 = 1 323 to pay; the others follow the same way.
   */
  it('lands every quarter on the krona', () => {
    const fall = [
      { kv: 1, utgaende: 252898, ingaende: 120597, facit: '1323.00' },
      { kv: 2, utgaende: 0, ingaende: 154233, facit: '-1542.00' },
      { kv: 3, utgaende: 29657, ingaende: 72888, facit: '-432.00' },
      { kv: 4, utgaende: 226540, ingaende: 414371, facit: '-1878.00' },
    ];

    for (const { kv, utgaende, ingaende, facit } of fall) {
      const manad = String(kv * 3).padStart(2, '0');
      const dag = `2025-${manad}-15`;
      const poster: BokfortVerifikat[] = [];

      if (utgaende > 0) {
        // A sale at 25 %: the net is four times the VAT.
        const netto = utgaende * 4;
        poster.push(
          verifikat(dag, [
            ['1930', kr(netto + utgaende)],
            ['3010', kr(-netto)],
            ['2610', kr(-utgaende)],
          ]),
        );
      }

      const inkopsnetto = ingaende * 4;
      poster.push(
        verifikat(dag, [
          ['5400', kr(inkopsnetto)],
          ['2640', kr(ingaende)],
          ['2013', kr(-(inkopsnetto + ingaende))],
        ]),
      );

      const rapport = beraknaMomsrapport({
        fran: datum(`2025-${String(kv * 3 - 2).padStart(2, '0')}-01`),
        till: datum(`2025-${manad}-28`),
        verifikat: poster,
      });

      expect(rapport.attBetala, `kvartal ${kv}`).toBe(oreFromKronor(facit));
    }
  });

  it('leaves out what falls outside the period', () => {
    const rapport = beraknaMomsrapport({
      ...kvartal(2025, 1),
      verifikat: [
        verifikat('2025-02-12', [
          ['2640', '100.00'],
          ['5400', '-100.00'],
        ]),
        verifikat('2025-05-12', [
          ['2640', '999.00'],
          ['5400', '-999.00'],
        ]),
      ],
    });

    expect(ruta(rapport, 48)).toBe(oreFromKronor('100.00'));
  });

  it('says nothing about accounts with nothing to declare', () => {
    const rapport = beraknaMomsrapport({
      ...kvartal(2025, 1),
      verifikat: [
        verifikat('2025-02-12', [
          ['1930', '-1000.00'],
          ['2013', '1000.00'],
        ]),
      ],
    });

    // Only box 49 remains, and it says nothing is owed either way.
    expect(rapport.rader.map((rad) => rad.ruta.nummer)).toEqual([49]);
    expect(rapport.attBetala).toBe(0);
  });

  it('keeps the exact figure beside the stated one', () => {
    const rapport = beraknaMomsrapport({
      ...kvartal(2025, 1),
      verifikat: [
        verifikat('2025-02-12', [
          ['2640', '270.38'],
          ['5400', '-270.38'],
        ]),
      ],
    });

    const rad = rapport.rader.find((post) => post.ruta.nummer === 48);
    expect(rad?.belopp).toBe(oreFromKronor('270.00'));
    // The öre are dropped from the box, not from the books.
    expect(rad?.exakt).toBe(oreFromKronor('270.38'));
  });

  it('handles reverse charge, where the same VAT is owed and deducted', () => {
    // An EU service purchase: box 21 carries the base, 30 the VAT owed, and
    // 48 the same VAT deducted, so nothing is actually paid.
    const rapport = beraknaMomsrapport({
      ...kvartal(2025, 1),
      verifikat: [
        verifikat('2025-02-12', [
          ['4535', '1000.00'],
          ['2614', '-250.00'],
          ['2645', '250.00'],
          ['2013', '-1000.00'],
        ]),
      ],
    });

    expect(ruta(rapport, 21)).toBe(oreFromKronor('-1000.00'));
    expect(ruta(rapport, 30)).toBe(oreFromKronor('250.00'));
    expect(ruta(rapport, 48)).toBe(oreFromKronor('250.00'));
    expect(rapport.attBetala).toBe(0);
  });
});

describe('harEuForsaljning', () => {
  /*
   * Selling into the EU means a second return - the periodisk sammanställning
   * - listing each buyer's VAT number. Kontera has the amounts but not the
   * buyers until the customer register arrives, so the least it can do is say
   * that the return is due.
   */
  it('notices a sale of goods to another EU country', () => {
    const rapport = beraknaMomsrapport({
      ...kvartal(2025, 1),
      verifikat: [
        verifikat('2025-02-13', [
          ['1930', '26400.00'],
          ['3058', '-26400.00'],
        ]),
      ],
    });

    expect(harEuForsaljning(rapport)).toBe(true);
    expect(ruta(rapport, 35)).toBe(oreFromKronor('26400.00'));
  });

  it('notices a sale of services under the main rule', () => {
    const rapport = beraknaMomsrapport({
      ...kvartal(2025, 1),
      verifikat: [
        verifikat('2025-02-13', [
          ['1930', '10000.00'],
          ['3048', '-10000.00'],
        ]),
      ],
    });

    expect(harEuForsaljning(rapport)).toBe(true);
    expect(ruta(rapport, 39)).toBe(oreFromKronor('10000.00'));
  });

  it('stays quiet for a purely domestic quarter', () => {
    const rapport = beraknaMomsrapport({
      ...kvartal(2025, 1),
      verifikat: [
        verifikat('2025-02-13', [
          ['1930', '1250.00'],
          ['3010', '-1000.00'],
          ['2610', '-250.00'],
        ]),
      ],
    });

    expect(harEuForsaljning(rapport)).toBe(false);
  });
});

/*
 * The momsredovisning at the end of a period moves the moms accounts' balances
 * to 2650, dated the period's last day - inside the period. Summed with
 * everything else, it cancelled the period out: on books imported from
 * another program every quarter read 0 in boxes 10, 48 and 49.
 *
 * A first quarter, settlement included: 2 528,98 out, 1 205,97 in, 1 323 to
 * pay, and -0,01 to öresutjämning.
 */
describe('a period with its own momsredovisning in it', () => {
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
  const avrakning = verifikat(
    '2025-03-31',
    [
      ['2610', '2528.98'],
      ['2640', '-1205.97'],
      ['2650', '-1323.00'],
      ['3740', '-0.01'],
    ],
    'Automatisk momsöverföring',
  );

  it('reports the period as if the settlement were not there', () => {
    const rapport = beraknaMomsrapport({
      ...kvartal(2025, 1),
      verifikat: [forsaljning, inkop, avrakning],
    });

    expect(ruta(rapport, 10)).toBe(oreFromKronor('2528'));
    expect(ruta(rapport, 48)).toBe(oreFromKronor('1205'));
    expect(rapport.attBetala).toBe(oreFromKronor('1323'));
  });

  it('recognises a settlement by what it moves, not by what it is called', () => {
    expect(arMomsavrakning(avrakning.konteringar)).toBe(true);
    expect(arMomsavrakning(inkop.konteringar)).toBe(false);
    // Paying what 2650 holds is not a settlement, and reaches no box anyway.
    expect(
      arMomsavrakning(
        verifikat('2025-05-12', [
          ['2650', '1323.00'],
          ['1630', '-1323.00'],
        ]).konteringar,
      ),
    ).toBe(false);
  });

  /*
   * Books migrated from another program can clear an old öre residue on 2641
   * against 3740 on the year's last day. It is rounding left over, not VAT on
   * anything bought, and the declaration for that quarter does not include
   * it - with it counted, the fourth quarter comes out a krona off.
   */
  it('treats clearing öre off a moms account the same way', () => {
    expect(
      arMomsavrakning(
        verifikat('2025-12-31', [
          ['2641', '-0.37'],
          ['3740', '0.37'],
        ]).konteringar,
      ),
    ).toBe(true);
  });

  it('can be booked into a period whose declaration is locked', () => {
    expect(paverkarMomsdeklarationen(avrakning.konteringar)).toBe(false);
  });
});

describe('paverkarMomsdeklarationen', () => {
  const rader = (...konton: string[]) =>
    konton.map((konto) => ({ konto: kontonummer(konto), belopp: oreFromKronor('1') }));

  it('says yes for moms accounts and sales accounts the declaration reads', () => {
    expect(paverkarMomsdeklarationen(rader('4010', '2640', '2013'))).toBe(true);
    expect(paverkarMomsdeklarationen(rader('3010', '1930'))).toBe(true);
  });

  it('says no for a periodisering, an avskrivning or a momsomföring', () => {
    expect(paverkarMomsdeklarationen(rader('1790', '5420'))).toBe(false);
    expect(paverkarMomsdeklarationen(rader('7832', '1229'))).toBe(false);
    expect(paverkarMomsdeklarationen(rader('1650', '2650'))).toBe(false);
  });
});
