import { describe, expect, it } from 'vitest';
import { oreFromKronor, sum } from '../belopp/ore';
import { kontonummer } from '../konto/konto';
import { beraknaMomsrapport, ruta } from './momsrapport';
import { datum } from '../tid/datum';
import { skapaUtkast, bokfor } from '../verifikat/verifikat';
import { verifikatserie } from '../verifikat/serie';
import { uuidv7 } from '../id/uuidv7';
import { utlandskopKonteringar, type Utlandskopstyp } from './utlandskop';

describe('utlandsköp med omvänd moms, 25% och full avdragsrätt', () => {
  it.each([
    ['eu-tjanst', 21, '4535'],
    ['eu-vara', 20, '4515'],
    ['utanfor-eu-tjanst', 22, '4531'],
  ] as const)(
    'reports base and both VAT legs for %s without deducting VAT from the payment',
    (typ, box, konto) => {
      const rader = utlandskopKonteringar(
        typ,
        oreFromKronor('1100'),
        kontonummer('1930'),
      );
      expect(sum(rader.map((r) => r.belopp))).toBe(0);
      expect(rader.find((r) => r.konto === konto)?.belopp).toBe(110000);
      expect(rader.find((r) => r.konto === '1930')?.belopp).toBe(-110000);
      const v = bokfor(
        skapaUtkast({
          id: uuidv7(1788554000000, new Uint8Array(10)),
          datum: datum('2026-09-01'),
          beskrivning: 'Foreign service',
          konteringar: rader,
        }),
        {
          serie: verifikatserie('A'),
          nummer: 1,
          bokfortDatum: datum('2026-09-01'),
          kalla: 'manuell',
        },
      );
      const rapport = beraknaMomsrapport({
        fran: datum('2026-09-01'),
        till: datum('2026-09-30'),
        verifikat: [v],
      });
      expect(ruta(rapport, box)).toBe(110000);
      expect(ruta(rapport, 30)).toBe(27500);
      expect(ruta(rapport, 48)).toBe(27500);
      expect(ruta(rapport, 49)).toBe(0);
    },
  );
  it('reverses the base, payment and both VAT rows for a credit note', () => {
    const rows = utlandskopKonteringar(
      'eu-tjanst',
      oreFromKronor('-1100'),
      kontonummer('1930'),
    );
    expect(rows.map((r) => r.belopp)).toEqual([-110000, 27500, -27500, 110000]);
  });
  it('rounds half an öre away from zero', () => {
    for (const [base, vat] of [
      ['0.02', 1],
      ['-0.02', -1],
    ] as const) {
      expect(
        utlandskopKonteringar('eu-tjanst', oreFromKronor(base), kontonummer('1930')).find(
          (r) => r.konto === '2645',
        )?.belopp,
      ).toBe(vat);
    }
  });
  it('refuses an unknown purchase type, zero and a non-payment account', () => {
    expect(() =>
      utlandskopKonteringar(
        'other' as Utlandskopstyp,
        oreFromKronor('10'),
        kontonummer('1930'),
      ),
    ).toThrow();
    expect(() =>
      utlandskopKonteringar('eu-tjanst', oreFromKronor('0'), kontonummer('1930')),
    ).toThrow();
    expect(() =>
      utlandskopKonteringar('eu-tjanst', oreFromKronor('10'), kontonummer('3000')),
    ).toThrow();
  });
});
