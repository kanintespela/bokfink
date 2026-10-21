import { describe, expect, it } from 'vitest';

import type { Uuid } from '../id/uuidv7';
import type { Rakenskapsar } from '../rakenskapsar/rakenskapsar';
import type { BokfortVerifikat } from '../verifikat/verifikat';
import { datum } from '../tid/datum';
import { verifikatserie } from '../verifikat/serie';
import {
  mimeAvFilnamn,
  planeraUnderlagsimport,
  tolkaUnderlagsnamn,
} from './underlagsimport';

const id = (n: number) =>
  `019b76da-a800-7000-8000-${String(n).padStart(12, '0')}` as Uuid;

function verifikat(overstyr: Partial<BokfortVerifikat> = {}): BokfortVerifikat {
  return {
    status: 'bokfort',
    id: id(1),
    serie: verifikatserie('A'),
    nummer: 50,
    datum: datum('2025-12-03'),
    bokfortDatum: datum('2025-12-03'),
    beskrivning: 'Inköp av foder',
    konteringar: [],
    kalla: 'sie-import',
    ...overstyr,
  };
}

function ar(start: string, slut: string, n = 9): Rakenskapsar {
  return {
    id: id(n),
    start: datum(start),
    slut: datum(slut),
    avslutat: true,
    ingaendeBalanser: [],
  };
}

const AR_2025 = ar('2025-01-01', '2025-12-31', 91);

describe('tolkaUnderlagsnamn', () => {
  it('reads year, series, number and the file name', () => {
    expect(tolkaUnderlagsnamn('2025-A50-hosilage.pdf')).toEqual({
      ar: '2025',
      serie: 'A',
      nummer: 50,
      filnamn: 'hosilage.pdf',
    });
  });

  /* The file's own name is whatever is left, dashes and Swedish letters included. */
  it('keeps the rest of the name intact', () => {
    expect(tolkaUnderlagsnamn('2026-A19-20260425_09.37-kvitto.pdf')?.filnamn).toBe(
      '20260425_09.37-kvitto.pdf',
    );
    expect(tolkaUnderlagsnamn('2025-A17-Märklappar stallmästaren.pdf')?.filnamn).toBe(
      'Märklappar stallmästaren.pdf',
    );
  });

  it('refuses names that carry no verifikat', () => {
    expect(tolkaUnderlagsnamn('kvitto.jpg')).toBeUndefined();
    expect(tolkaUnderlagsnamn('okopplat-4-Levfaktura.pdf')).toBeUndefined();
    // A series ending in a digit would make the number ambiguous, so it is
    // not read at all rather than read wrongly.
    expect(tolkaUnderlagsnamn('2025-A1B2-kvitto.pdf')).toBeUndefined();
    // A year is four digits; a stray date prefix is not a verifikat.
    expect(tolkaUnderlagsnamn('20250101-kvitto.pdf')).toBeUndefined();
  });
});

describe('mimeAvFilnamn', () => {
  it('reads the four types an archive may hold', () => {
    expect(mimeAvFilnamn('kvitto.JPG')).toBe('image/jpeg');
    expect(mimeAvFilnamn('faktura.pdf')).toBe('application/pdf');
    expect(mimeAvFilnamn('skärmbild.png')).toBe('image/png');
    expect(mimeAvFilnamn('bild.webp')).toBe('image/webp');
  });

  /* A guess that is not one of the four is no help; the import says so. */
  it('says nothing about anything else', () => {
    expect(mimeAvFilnamn('kvitto.heic')).toBeUndefined();
    expect(mimeAvFilnamn('kvitto')).toBeUndefined();
  });
});

describe('planeraUnderlagsimport', () => {
  it('links a file to the verifikat its name names', () => {
    const [rad] = planeraUnderlagsimport(
      ['2025-A50-hosilage.pdf'],
      [verifikat()],
      [AR_2025],
    );
    expect(rad).toEqual({
      namn: '2025-A50-hosilage.pdf',
      filnamn: 'hosilage.pdf',
      verifikat: id(1),
      beteckning: 'A50',
    });
  });

  /*
   * Hard rule 6: numbers run per series and fiscal year, so A50 exists once
   * in every year. The year in the name is what keeps them apart - matching
   * on series and number alone would attach last year's receipt to this
   * year's booking.
   */
  it('keeps the same number in two years apart', () => {
    const i2025 = verifikat({ id: id(1), datum: datum('2025-12-03') });
    const i2026 = verifikat({ id: id(2), datum: datum('2026-12-03') });
    const ar2026 = ar('2026-01-01', '2026-12-31', 92);

    const plan = planeraUnderlagsimport(
      ['2025-A50-foder.pdf', '2026-A50-foder.pdf'],
      [i2025, i2026],
      [AR_2025, ar2026],
    );

    expect(plan.map((rad) => rad.verifikat)).toEqual([id(1), id(2)]);
  });

  /* A broken fiscal year is still one book, and its start year names it. */
  it('places a verifikat in a fiscal year that is not a calendar year', () => {
    const brutet = ar('2025-07-01', '2026-06-30', 93);
    const i = verifikat({ datum: datum('2026-02-10') });

    const [rad] = planeraUnderlagsimport(['2025-A50-foder.pdf'], [i], [brutet]);

    expect(rad?.verifikat).toBe(id(1));
  });

  /*
   * Hard rule 10 in the small: nothing is refused, but nothing is guessed
   * either. A file that cannot be placed is still evidence and is imported
   * without a link, with the reason in plain Swedish (hard rule 11).
   */
  it('imports what it cannot place, unlinked and with a reason', () => {
    const plan = planeraUnderlagsimport(
      ['kvitto.jpg', '2025-A99-foder.pdf', '2019-A50-foder.pdf'],
      [verifikat()],
      [AR_2025],
    );

    expect(plan.map((rad) => rad.verifikat)).toEqual([undefined, undefined, undefined]);
    expect(plan[0]?.filnamn).toBe('kvitto.jpg');
    expect(plan[1]?.orsak).toBe('Verifikat A99 finns inte i 2025.');
    expect(plan[2]?.orsak).toBe('Det finns inget räkenskapsår som börjar 2019.');
  });

  it('is unchanged by being run twice', () => {
    const namn = ['2025-A50-hosilage.pdf', 'kvitto.jpg'];
    const forst = planeraUnderlagsimport(namn, [verifikat()], [AR_2025]);
    const igen = planeraUnderlagsimport(namn, [verifikat()], [AR_2025]);
    expect(igen).toEqual(forst);
  });
});
