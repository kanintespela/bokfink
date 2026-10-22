import { describe, expect, it } from 'vitest';

import { rakenskapsarsid, skapaRakenskapsar } from '../rakenskapsar/rakenskapsar';
import { datum } from '../tid/datum';
import {
  kommandeMomsdeklarationer,
  sistaDeklarationsdagForKvartal,
  vantandeMomsdeklarationer,
} from './deklarationsdag';
import { perioder } from './period';

function kvartal(ar: number) {
  return perioder(datum(`${ar}-01-01`), datum(`${ar}-12-31`), 'kvartal');
}

function ar(start: string, uppgifter: { avslutat?: boolean; momslastTom?: string } = {}) {
  const fran = datum(start);
  return skapaRakenskapsar({
    id: rakenskapsarsid(fran),
    start: fran,
    slut: datum(`${start.slice(0, 4)}-12-31`),
    avslutat: uppgifter.avslutat ?? false,
    ...(uppgifter.momslastTom === undefined
      ? {}
      : { momslastTom: datum(uppgifter.momslastTom) }),
  });
}

describe('sistaDeklarationsdagForKvartal', () => {
  it('follows the table in SFL 26 kap. 26 § when the day is a vardag', () => {
    // 2026: Tuesday 12 May, Monday 17 August, Thursday 12 November, and
    // Friday 12 February 2027 for the fourth quarter.
    expect(kvartal(2026).map(sistaDeklarationsdagForKvartal)).toEqual([
      '2026-05-12',
      '2026-08-17',
      '2026-11-12',
      '2027-02-12',
    ]);
  });

  it('moves a deadline on a weekend to the next vardag', () => {
    // 17 August 2025 is a Sunday, 17 August 2024 a Saturday.
    expect(sistaDeklarationsdagForKvartal(kvartal(2025)[1]!)).toBe('2025-08-18');
    expect(sistaDeklarationsdagForKvartal(kvartal(2024)[1]!)).toBe('2024-08-19');
    // 12 February 2028 is a Saturday.
    expect(sistaDeklarationsdagForKvartal(kvartal(2027)[3]!)).toBe('2028-02-14');
  });

  it('moves a deadline off Kristi himmelsfärdsdag', () => {
    // Easter 2067 is 3 April, so Kristi himmelsfärdsdag is Thursday 12 May.
    expect(sistaDeklarationsdagForKvartal(kvartal(2067)[0]!)).toBe('2067-05-13');
  });

  it('refuses a period that is not a calendar quarter', () => {
    const manad = perioder(datum('2026-01-01'), datum('2026-12-31'), 'manad')[0]!;
    expect(() => sistaDeklarationsdagForKvartal(manad)).toThrow(RangeError);
  });
});

describe('vantandeMomsdeklarationer', () => {
  it('lists the quarters that have ended and are not locked, oldest first', () => {
    const vantande = vantandeMomsdeklarationer(
      [ar('2026-01-01', { momslastTom: '2026-03-31' })],
      'kvartal',
      datum('2026-10-04'),
    );

    expect(vantande).toEqual([
      {
        period: kvartal(2026)[1],
        sistaDag: '2026-08-17',
        dagarKvar: -48,
      },
      {
        period: kvartal(2026)[2],
        sistaDag: '2026-11-12',
        dagarKvar: 39,
      },
    ]);
  });

  it('does not list a quarter until the day after it ends', () => {
    const lista = (idag: string) =>
      vantandeMomsdeklarationer([ar('2026-01-01')], 'kvartal', datum(idag)).map(
        (v) => v.period.namn,
      );
    expect(lista('2026-03-31')).toEqual([]);
    expect(lista('2026-04-01')).toEqual(['2026 kv 1']);
  });

  it('carries the fourth quarter of last year into the new one', () => {
    const vantande = vantandeMomsdeklarationer(
      [ar('2025-01-01', { momslastTom: '2025-09-30' }), ar('2026-01-01')],
      'kvartal',
      datum('2026-01-20'),
    );
    expect(vantande.map((v) => [v.period.namn, v.sistaDag, v.dagarKvar])).toEqual([
      ['2025 kv 4', '2026-02-12', 23],
    ]);
  });

  it('skips a closed year and a fully locked one', () => {
    expect(
      vantandeMomsdeklarationer(
        [
          ar('2024-01-01', { avslutat: true }),
          ar('2025-01-01', { momslastTom: '2025-12-31' }),
        ],
        'kvartal',
        datum('2026-01-20'),
      ),
    ).toEqual([]);
  });

  it('gives no date for monthly or yearly periods rather than guess one', () => {
    for (const momsperiod of ['manad', 'ar'] as const) {
      expect(
        vantandeMomsdeklarationer([ar('2026-01-01')], momsperiod, datum('2026-10-04')),
      ).toEqual([]);
    }
  });
});

describe('kommandeMomsdeklarationer', () => {
  it('lists every unlocked quarter still ahead, ended or not', () => {
    const kommande = kommandeMomsdeklarationer(
      [ar('2026-01-01', { momslastTom: '2026-03-31' })],
      'kvartal',
      datum('2026-10-04'),
    );
    // Kvartal 2 fell due on 17 August and is left out: a calendar entry in
    // the past reminds nobody of anything.
    expect(kommande.map((k) => [k.period.namn, k.sistaDag])).toEqual([
      ['2026 kv 3', '2026-11-12'],
      ['2026 kv 4', '2027-02-12'],
    ]);
  });

  it('keeps a quarter due today', () => {
    expect(
      kommandeMomsdeklarationer([ar('2026-01-01')], 'kvartal', datum('2026-11-12')).map(
        (k) => k.period.namn,
      ),
    ).toEqual(['2026 kv 3', '2026 kv 4']);
  });

  it('gives nothing for a closed year or a monthly period', () => {
    expect(
      kommandeMomsdeklarationer(
        [ar('2026-01-01', { avslutat: true })],
        'kvartal',
        datum('2026-10-04'),
      ),
    ).toEqual([]);
    expect(
      kommandeMomsdeklarationer([ar('2026-01-01')], 'manad', datum('2026-10-04')),
    ).toEqual([]);
  });
});
