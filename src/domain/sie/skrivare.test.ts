import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ore, oreFromKronor } from '../belopp/ore';
import { datum } from '../tid/datum';
import { avkodaPC8, kodaPC8 } from './pc8';
import { tolkaSie, type Siedokument } from './parser';
import { skrivSie } from './skrivare';

const tomt: Siedokument = {
  sietyp: 4,
  format: 'PC8',
  rakenskapsar: [{ index: 0, start: datum('2026-01-01'), slut: datum('2026-12-31') }],
  konton: [],
  ingaende: [],
  utgaende: [],
  resultat: [],
  verifikat: [],
  okandaEtiketter: [],
};

const med = (delar: Partial<Siedokument>): Siedokument => ({ ...tomt, ...delar });

/**
 * Text that actually exercises PC8. fc.string generates printable ASCII, so
 * a round trip built on it would never touch the half of the character set
 * where å, ä and ö live - which is the half that goes wrong.
 */
function svensktext(begransning: { minLength?: number; maxLength: number }) {
  return fc
    .array(
      fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzåäöÅÄÖ 0123456789.,-/%'.split(''),
        '"',
        '\\',
        'é',
        'ü',
      ),
      begransning,
    )
    .map((tecken) => tecken.join(''));
}

/** Documents the writer can produce, for the round trip property. */
const arbDokument: fc.Arbitrary<Siedokument> = fc
  .record(
    {
      orgnr: fc.stringMatching(/^\d{10}$/),
      foretagsnamn: svensktext({ minLength: 1, maxLength: 30 }),
      konton: fc.uniqueArray(
        fc.record(
          {
            nummer: fc.integer({ min: 1000, max: 8999 }).map(String),
            namn: svensktext({ minLength: 1, maxLength: 40 }),
            typ: fc.constantFrom('T' as const, 'S' as const, 'K' as const, 'I' as const),
            sru: fc.array(fc.integer({ min: 1000, max: 9999 }).map(String), {
              maxLength: 2,
            }),
          },
          // `typ` absent is the ordinary case for class 2, so it has to be
          // genuinely missing rather than present and undefined.
          { requiredKeys: ['nummer', 'namn', 'sru'] },
        ),
        { selector: (k) => k.nummer, maxLength: 8 },
      ),
      verifikat: fc.array(
        fc.record(
          {
            serie: fc.constantFrom('A', 'B', 'V'),
            nummer: fc.integer({ min: 1, max: 999 }).map(String),
            datum: fc.constantFrom('2026-01-09', '2026-06-30', '2026-12-31').map(datum),
            registrerad: fc
              .constantFrom('2026-01-12', '2026-07-01', '2027-01-05')
              .map(datum),
            text: svensktext({ maxLength: 40 }),
            transaktioner: fc.array(
              fc.record({
                konto: fc.integer({ min: 1000, max: 8999 }).map(String),
                belopp: fc.integer({ min: -9_999_999, max: 9_999_999 }).map(ore),
              }),
              { minLength: 1, maxLength: 4 },
            ),
          },
          { requiredKeys: ['serie', 'nummer', 'datum', 'text', 'transaktioner'] },
        ),
        { maxLength: 5 },
      ),
      ingaende: fc.array(
        fc.record({
          arsindex: fc.constantFrom(0, -1),
          konto: fc.integer({ min: 1000, max: 2999 }).map(String),
          belopp: fc.integer({ min: -9_999_999, max: 9_999_999 }).map(ore),
        }),
        { maxLength: 4 },
      ),
    },
    { requiredKeys: ['konton', 'verifikat', 'ingaende'] },
  )
  .map((delar) => ({ ...tomt, ...delar }));

describe('skrivSie', () => {
  it('writes the header a SIE reader expects first', () => {
    const rader = skrivSie(med({ orgnr: '1212121212' })).split('\n');
    expect(rader.slice(0, 4)).toEqual([
      '#FLAGGA 0',
      '#FORMAT PC8',
      '#SIETYP 4',
      '#ORGNR 1212121212',
    ]);
  });

  it('quotes the fields the format quotes and leaves the rest bare', () => {
    const text = skrivSie(
      med({
        konton: [{ nummer: '1150', namn: 'Markanläggningar', typ: 'T', sru: ['7214'] }],
      }),
    );
    expect(text).toContain('#KONTO 1150 "Markanläggningar"');
    expect(text).toContain('#KTYP 1150 T');
    expect(text).toContain('#SRU 1150 7214');
  });

  it('writes a verifikat with its lines inside braces', () => {
    const text = skrivSie(
      med({
        verifikat: [
          {
            serie: 'A',
            nummer: '2',
            datum: datum('2026-01-09'),
            text: 'Inköp av mineralfoder',
            registrerad: datum('2026-01-12'),
            transaktioner: [
              { konto: '2013', belopp: oreFromKronor('-520.31') },
              { konto: '4010', belopp: oreFromKronor('416.25') },
            ],
          },
        ],
      }),
    );

    expect(text).toContain(
      '#VER "A" 2 20260109 "Inköp av mineralfoder" 20260112\n{\n' +
        '#TRANS 2013 {} -520.31\n#TRANS 4010 {} 416.25\n}',
    );
  });

  it('writes amounts with two decimals and no float on the way out', () => {
    const text = skrivSie(
      med({
        ingaende: [{ arsindex: 0, konto: '1110', belopp: oreFromKronor('52418.37') }],
      }),
    );
    expect(text).toContain('#IB 0 1110 52418.37');
  });

  it('escapes a quotation mark inside a description', () => {
    const text = skrivSie(
      med({
        verifikat: [
          {
            serie: 'A',
            nummer: '1',
            datum: datum('2026-01-09'),
            text: 'Faktura "9"',
            transaktioner: [{ konto: '1930', belopp: ore(0) }],
          },
        ],
      }),
    );
    expect(text).toContain('"Faktura \\"9\\""');
    expect(tolkaSie(text).verifikat[0]?.text).toBe('Faktura "9"');
  });
});

describe('the round trip', () => {
  /*
   * The property the plan asks for: a SIE export followed by an import gives
   * back identical data. Asserted over generated documents rather than one
   * example, because the failure that matters is the field nobody thought to
   * write a case for.
   */
  it('parses back into exactly what was written', () => {
    fc.assert(
      fc.property(arbDokument, (dokument) => {
        expect(tolkaSie(skrivSie(dokument))).toEqual(dokument);
      }),
      { numRuns: 300 },
    );
  });

  it('survives the character encoding as well', () => {
    fc.assert(
      fc.property(arbDokument, (dokument) => {
        const bytes = kodaPC8(skrivSie(dokument));
        expect(tolkaSie(avkodaPC8(bytes))).toEqual(dokument);
      }),
      { numRuns: 100 },
    );
  });
});
