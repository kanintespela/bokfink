import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { oreFromKronor, ZERO, type Ore } from '../belopp/ore';
import { uuidv7 } from '../id/uuidv7';
import { halvtPrisbasbelopp } from '../skatt/skattetabell';
import { datum } from '../tid/datum';
import { avyttra, skapaAnlaggningstillgang } from './anlaggningstillgang';
import {
  avskrivningsforslag,
  avskrivningsunderlag,
  huvudregeln,
  kompletteringsregeln,
  NegativtAvskrivningsunderlagError,
  restvardesavskrivning,
} from './avskrivning';

let raknare = 0;
const nyttId = () =>
  uuidv7(1_788_554_000_000 + (raknare += 1), new Uint8Array(10).fill(1));

const tillgang = (anskaffningsvarde: string, anskaffningsdatum: string) =>
  skapaAnlaggningstillgang({
    id: nyttId(),
    benamning: 'Maskin',
    anskaffningsdatum: datum(anskaffningsdatum),
    anskaffningsvarde: oreFromKronor(anskaffningsvarde),
    nyttjandeperiod: 10,
  });

/*
 * Every figure below is copied straight from BFN's own K1-vägledning
 * (BFNAR 2006:1, uppdaterad 2025-03-24), exempel till kapitel 6 - not
 * derived independently. If these fail, the arithmetic disagrees with the
 * source it is supposed to implement.
 */
describe('avskrivningsunderlag', () => {
  it('exempel 6-5: IB 175 000 + inköp 50 000 = 225 000', () => {
    expect(
      avskrivningsunderlag(oreFromKronor('175000'), oreFromKronor('50000'), ZERO),
    ).toBe(oreFromKronor('225000'));
  });

  it('exempel 6-8: IB 175 000 + inköp 32 000 - avyttrat 37 000 = 170 000', () => {
    expect(
      avskrivningsunderlag(
        oreFromKronor('175000'),
        oreFromKronor('32000'),
        oreFromKronor('37000'),
      ),
    ).toBe(oreFromKronor('170000'));
  });
});

describe('huvudregeln', () => {
  it('exempel 6-5: 30 % av 225 000 = 67 500', () => {
    expect(huvudregeln(oreFromKronor('225000'))).toBe(oreFromKronor('67500'));
  });

  it('exempel 6-6, år 1: 30 % av 37 000 = 11 100', () => {
    expect(huvudregeln(oreFromKronor('37000'))).toBe(oreFromKronor('11100'));
  });

  it('exempel 6-8: 30 % av 170 000 = 51 000', () => {
    expect(huvudregeln(oreFromKronor('170000'))).toBe(oreFromKronor('51000'));
  });

  it('rounds to the nearest öre rather than truncating', () => {
    // 5 öre × 30 % = 1,5 öre, halves away from zero → 2 öre.
    expect(huvudregeln(5 as Ore)).toBe(2 as Ore);
  });
});

describe('restvardesavskrivning', () => {
  it('is 25 % of the underlag', () => {
    expect(restvardesavskrivning(oreFromKronor('225000'))).toBe(oreFromKronor('56250'));
  });
});

describe('kompletteringsregeln', () => {
  it('allows 20 % less of the acquisition value per whole year held', () => {
    const innehav = [tillgang('100000', '2026-03-01')];
    // Held during fiscal year 2026 (year 1 of the schedule): allowed value
    // is 100 000 − 20 % = 80 000.
    const underlag = oreFromKronor('90000');
    expect(kompletteringsregeln(underlag, innehav, datum('2026-12-31'))).toBe(
      oreFromKronor('10000'),
    ); // 90 000 − 80 000

    // A year later (year 2): allowed value is 100 000 − 40 % = 60 000.
    expect(kompletteringsregeln(underlag, innehav, datum('2027-12-31'))).toBe(
      oreFromKronor('30000'),
    ); // 90 000 − 60 000
  });

  it('never asks for more depreciation than the pool actually holds', () => {
    const innehav = [tillgang('100000', '2026-03-01')];
    const underlag = oreFromKronor('50000'); // below what year 1 would allow (80 000)
    expect(kompletteringsregeln(underlag, innehav, datum('2026-12-31'))).toBe(ZERO);
  });

  it('floors the allowed value at zero after five years', () => {
    const innehav = [tillgang('100000', '2020-01-01')];
    const underlag = oreFromKronor('40000');
    // Year 7: fully written down, so the whole underlag is depreciation.
    expect(kompletteringsregeln(underlag, innehav, datum('2026-12-31'))).toBe(
      oreFromKronor('40000'),
    );
  });

  it('leaves out an asset that has already been avyttrad', () => {
    const kvar = tillgang('100000', '2026-03-01');
    const salt = avyttra(tillgang('50000', '2026-03-01'), {
      datum: datum('2026-06-01'),
      typ: 'forsaljning',
      forsaljningsinkomst: oreFromKronor('40000'),
    });
    const underlag = oreFromKronor('10000');
    // Only `kvar` counts: allowed value 80 000, so nothing is required here.
    expect(kompletteringsregeln(underlag, [kvar, salt], datum('2026-12-31'))).toBe(ZERO);
  });
});

describe('avskrivningsforslag', () => {
  const AR_2025 = halvtPrisbasbelopp(2025); // 29 400 kr

  it('offers all three methods together', () => {
    const forslag = avskrivningsforslag(
      oreFromKronor('225000'),
      [],
      datum('2026-12-31'),
      AR_2025,
    );
    expect(forslag.huvudregeln).toBe(oreFromKronor('67500'));
    expect(forslag.restvardesavskrivning).toBe(oreFromKronor('56250'));
    expect(forslag.helaUnderlaget).toBeUndefined();
  });

  it('exempel 6-6, år 2: underlaget är under halvt prisbasbelopp, hela beloppet får skrivas av', () => {
    const forslag = avskrivningsforslag(
      oreFromKronor('25900'),
      [],
      datum('2026-12-31'),
      AR_2025,
    );
    expect(forslag.helaUnderlaget).toBe(oreFromKronor('25900'));
  });

  it('offers the direktavdrag exactly at the boundary, not just below it', () => {
    const forslag = avskrivningsforslag(AR_2025, [], datum('2026-12-31'), AR_2025);
    expect(forslag.helaUnderlaget).toBe(AR_2025);
  });

  it('refuses a negative underlag rather than reporting a nonsense figure', () => {
    expect(() =>
      avskrivningsforslag(oreFromKronor('-1'), [], datum('2026-12-31'), AR_2025),
    ).toThrow(NegativtAvskrivningsunderlagError);
  });
});

describe('invarianter', () => {
  const rimligtUnderlag = fc.integer({ min: 0, max: 100_000_000 }).map((v) => v as Ore);

  it('huvudregeln skriver aldrig av mer än underlaget eller ger ett negativt belopp', () => {
    fc.assert(
      fc.property(rimligtUnderlag, (underlag) => {
        const avskrivning = huvudregeln(underlag);
        expect(avskrivning).toBeGreaterThanOrEqual(0);
        expect(avskrivning).toBeLessThanOrEqual(underlag);
      }),
    );
  });

  it('restvärdesavskrivning skriver aldrig av mer än underlaget eller ger ett negativt belopp', () => {
    fc.assert(
      fc.property(rimligtUnderlag, (underlag) => {
        const avskrivning = restvardesavskrivning(underlag);
        expect(avskrivning).toBeGreaterThanOrEqual(0);
        expect(avskrivning).toBeLessThanOrEqual(underlag);
      }),
    );
  });

  it('kompletteringsregeln ger aldrig ett negativt belopp', () => {
    fc.assert(
      fc.property(
        rimligtUnderlag,
        fc.integer({ min: 1000, max: 10_000_000 }).map((v) => v as Ore),
        (underlag, anskaffningsvarde) => {
          const innehav = [
            tillgang(String(Math.floor(anskaffningsvarde / 100)), '2026-01-01'),
          ];
          expect(
            kompletteringsregeln(underlag, innehav, datum('2026-12-31')),
          ).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
