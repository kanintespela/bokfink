import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import type { Uuid } from '../domain/id/uuidv7';
import {
  kontonummer,
  skapaKonto,
  type Konto,
  type Kontonummer,
} from '../domain/konto/konto';
import {
  PeriodLastError,
  skapaRakenskapsar,
  type Rakenskapsar,
} from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import {
  bokfor,
  ObalanseratVerifikatError,
  skapaUtkast,
  type BokfortVerifikat,
} from '../domain/verifikat/verifikat';
import { granskaForslag, type Granskningsunderlag } from './forslag';

const ID = '01990000-0000-7000-8000-0000000000aa' as Uuid;
const AR_2026 = '01990000-0000-7000-8000-000000002026' as Uuid;
const IDAG = datum('2026-12-31');

function konton(...poster: Konto[]): ReadonlyMap<Kontonummer, Konto> {
  return new Map(poster.map((konto) => [konto.nummer, konto]));
}

function bocker(
  andringar: Partial<Rakenskapsar> = {},
  verifikat: readonly BokfortVerifikat[] = [],
): Granskningsunderlag {
  const ar = {
    ...skapaRakenskapsar({
      id: AR_2026,
      start: datum('2026-01-01'),
      slut: datum('2026-12-31'),
    }),
    ...andringar,
  };
  return {
    konton: konton(
      skapaKonto({ nummer: '4010', namn: 'Inköp av material och varor' }),
      skapaKonto({ nummer: '2640', namn: 'Ingående moms' }),
      skapaKonto({ nummer: '2013', namn: 'Eget uttag' }),
      skapaKonto({ nummer: '5460', namn: 'Förbrukningsemballage', aktiv: false }),
    ),
    rakenskapsar: new Map([[ar.id, ar]]),
    verifikat: new Map(verifikat.map((post) => [post.id, post])),
  };
}

/** Foder for 500 kr including 25 % moms, paid with private money. */
const foder = (andringar: Record<string, unknown> = {}) => ({
  datum: '2026-09-04',
  beskrivning: 'Foder, Lantmännen',
  konteringar: [
    { konto: '4010', belopp: '400,00' },
    { konto: '2640', belopp: '100.00' },
    { konto: '2013', belopp: '-500' },
  ],
  underlag: ['/tmp/kvitto.jpg'],
  ...andringar,
});

describe('granskaForslag', () => {
  it('builds the draft, with every amount in öre', () => {
    const { utkast, underlag, varningar } = granskaForslag(foder(), bocker(), ID, IDAG);

    expect(utkast).toEqual({
      status: 'utkast',
      id: ID,
      datum: '2026-09-04',
      beskrivning: 'Foder, Lantmännen',
      konteringar: [
        { konto: '4010', belopp: 40000 },
        { konto: '2640', belopp: 10000 },
        { konto: '2013', belopp: -50000 },
      ],
    });
    expect(underlag).toEqual(['/tmp/kvitto.jpg']);
    expect(varningar).toEqual([]);
  });

  /*
   * Hard rule 1 at the door. JSON has only floats, so an amount written as a
   * number has already been through one - and 0.1 + 0.2 is not 0.3.
   */
  it('refuses amounts written as numbers', () => {
    expect(() =>
      granskaForslag(
        foder({
          konteringar: [
            { konto: '4010', belopp: 400.1 },
            { konto: '2013', belopp: -400.1 },
          ],
        }),
        bocker(),
        ID,
        IDAG,
      ),
    ).toThrow('går inte att läsa');
  });

  it('keeps öre exact when a single decimal is written', () => {
    const { utkast } = granskaForslag(
      foder({
        konteringar: [
          { konto: '4010', belopp: '400.1' },
          { konto: '2013', belopp: '-400,10' },
        ],
      }),
      bocker(),
      ID,
      IDAG,
    );
    expect(utkast.konteringar.map((rad) => rad.belopp)).toEqual([40010, -40010]);
  });

  it('refuses rows that do not balance', () => {
    expect(() =>
      granskaForslag(
        foder({
          konteringar: [
            { konto: '4010', belopp: '400,00' },
            { konto: '2013', belopp: '-399,99' },
          ],
        }),
        bocker(),
        ID,
        IDAG,
      ),
    ).toThrow(ObalanseratVerifikatError);
  });

  it('refuses an account the kontoplan does not have', () => {
    expect(() =>
      granskaForslag(
        foder({
          konteringar: [
            { konto: '5611', belopp: '400,00' },
            { konto: '2013', belopp: '-400,00' },
          ],
        }),
        bocker(),
        ID,
        IDAG,
      ),
    ).toThrow('Konto 5611 finns inte i kontoplanen');
  });

  it('refuses an inactive account', () => {
    expect(() =>
      granskaForslag(
        foder({
          konteringar: [
            { konto: '5460', belopp: '400,00' },
            { konto: '2013', belopp: '-400,00' },
          ],
        }),
        bocker(),
        ID,
        IDAG,
      ),
    ).toThrow('inaktivt');
  });

  it('refuses a row with nothing on it', () => {
    expect(() =>
      granskaForslag(
        foder({
          konteringar: [
            { konto: '4010', belopp: '400,00' },
            { konto: '2640', belopp: '0' },
            { konto: '2013', belopp: '-400,00' },
          ],
        }),
        bocker(),
        ID,
        IDAG,
      ),
    ).toThrow('saknar belopp');
  });

  it('refuses a suggestion without a receipt', () => {
    expect(() => granskaForslag(foder({ underlag: [] }), bocker(), ID, IDAG)).toThrow(
      'saknar underlag',
    );
  });

  it('refuses a date no fiscal year covers', () => {
    expect(() =>
      granskaForslag(foder({ datum: '2027-01-02' }), bocker(), ID, datum('2027-01-10')),
    ).toThrow('inget räkenskapsår');
  });

  /*
   * The phone would refuse these at booking. Refusing them here means the
   * one review a draft gets is not spent on something that cannot be booked.
   */
  it('refuses a date in a period whose momsdeklaration is filed', () => {
    expect(() =>
      granskaForslag(foder(), bocker({ momslastTom: datum('2026-09-30') }), ID, IDAG),
    ).toThrow(PeriodLastError);
  });

  it('accepts the day after the lock', () => {
    expect(() =>
      granskaForslag(
        foder({ datum: '2026-10-01' }),
        bocker({ momslastTom: datum('2026-09-30') }),
        ID,
        IDAG,
      ),
    ).not.toThrow();
  });

  it('refuses a date after today', () => {
    expect(() =>
      granskaForslag(foder({ datum: '2026-10-01' }), bocker(), ID, datum('2026-09-13')),
    ).toThrow('har inte hänt än');
  });

  it('refuses a closed year', () => {
    expect(() => granskaForslag(foder(), bocker({ avslutat: true }), ID, IDAG)).toThrow(
      PeriodLastError,
    );
  });

  it('warns about a booked verifikat with the same date and total', () => {
    const redan = bokfor(
      skapaUtkast({
        id: '01990000-0000-7000-8000-0000000000bb' as Uuid,
        datum: datum('2026-09-04'),
        beskrivning: 'Lantmännen foder',
        konteringar: [
          { konto: kontonummer('4010'), belopp: oreFromKronor('500') },
          { konto: kontonummer('2013'), belopp: oreFromKronor('-500') },
        ],
      }),
      {
        serie: verifikatserie('A'),
        nummer: 7,
        bokfortDatum: datum('2026-09-04'),
        kalla: 'manuell',
      },
    );

    const { varningar } = granskaForslag(foder(), bocker({}, [redan]), ID, IDAG);
    expect(varningar).toHaveLength(1);
    expect(varningar[0]).toContain('A7');
  });
});
