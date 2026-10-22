import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ore, oreFromKronor, sum } from '../belopp/ore';
import { kontonummer } from '../konto/konto';
import { datum } from '../tid/datum';
import type { Uuid } from '../id/uuidv7';
import { verifikatserie } from '../verifikat/serie';
import { bokfor, skapaUtkast, type BokfortVerifikat } from '../verifikat/verifikat';
import { beroradaKonton, kontoutdrag } from './kontoutdrag';

let raknare = 0;
const nyttId = () =>
  `019b76da-a800-7000-8000-${String((raknare += 1)).padStart(12, '0')}` as Uuid;

function verifikat(
  nummer: number,
  datumtext: string,
  rader: readonly (readonly [string, string])[],
  beskrivning = 'Inköp av kraftfoder',
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
      nummer,
      bokfortDatum: datum(datumtext),
      kalla: 'manuell',
    },
  );
}

describe('kontoutdrag', () => {
  const kontot = kontonummer('1930');

  it('carries the balance along, movement by movement', () => {
    const utdrag = kontoutdrag(kontot, oreFromKronor('23817.45'), [
      verifikat(1, '2026-01-16', [
        ['1930', '-249.00'],
        ['5420', '249.00'],
      ]),
      verifikat(2, '2026-03-19', [
        ['1930', '25000.00'],
        ['2013', '-25000.00'],
      ]),
    ]);

    expect(utdrag.rader.map((rad) => rad.saldo)).toEqual([
      oreFromKronor('23568.45'),
      oreFromKronor('48568.45'),
    ]);
    expect(utdrag.utgaende).toBe(oreFromKronor('48568.45'));
    expect(utdrag.in).toBe(oreFromKronor('25000.00'));
    expect(utdrag.ut).toBe(oreFromKronor('-249.00'));
  });

  it('leaves out verifikat that never touched the account', () => {
    const utdrag = kontoutdrag(kontot, ore(0), [
      verifikat(1, '2026-01-09', [
        ['2013', '-520.31'],
        ['4010', '520.31'],
      ]),
    ]);
    expect(utdrag.rader).toEqual([]);
    expect(utdrag.utgaende).toBe(0);
  });

  /*
   * A year-end verifikat can book two depreciations against two accumulated accounts in one
   * verifikat. Summing them away would make the statement disagree with the
   * verifikat it came from.
   */
  it('keeps two lines on the same account as two rows', () => {
    const utdrag = kontoutdrag(kontonummer('1229'), ore(0), [
      verifikat(
        58,
        '2025-12-31',
        [
          ['7830', '6400.00'],
          ['7830', '5800.00'],
          ['1229', '-6400.00'],
          ['1229', '-5800.00'],
        ],
        'avskrivningar inventarier',
      ),
    ]);

    expect(utdrag.rader).toHaveLength(2);
    expect(utdrag.utgaende).toBe(oreFromKronor('-12200.00'));
  });

  it('sorts by date, whatever order the verifikat arrive in', () => {
    const senare = verifikat(1, '2026-03-19', [
      ['1930', '100.00'],
      ['3010', '-100.00'],
    ]);
    const tidigare = verifikat(2, '2026-01-08', [
      ['1930', '50.00'],
      ['3010', '-50.00'],
    ]);

    // Numbered in booking order, which runs the other way from the dates.
    expect(
      kontoutdrag(kontot, ore(0), [senare, tidigare]).rader.map((r) => r.datum),
    ).toEqual(['2026-01-08', '2026-03-19']);
  });

  it('prefers the line note over the description when there is one', () => {
    const post = bokfor(
      skapaUtkast({
        id: nyttId(),
        datum: datum('2026-03-31'),
        beskrivning: 'Automatisk momsöverföring',
        konteringar: [
          { konto: kontot, belopp: oreFromKronor('-4210.00'), text: 'Period 202603' },
          { konto: kontonummer('2650'), belopp: oreFromKronor('4210.00') },
        ],
      }),
      {
        serie: verifikatserie('A'),
        nummer: 23,
        bokfortDatum: datum('2026-06-02'),
        kalla: 'manuell',
      },
    );

    const utdrag = kontoutdrag(kontot, ore(0), [post]);
    expect(utdrag.rader[0]?.text).toBe('Period 202603');
  });

  it('ends where the opening balance plus every movement lands', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }).map(ore),
        fc.array(fc.integer({ min: -100_000, max: 100_000 }), { maxLength: 20 }),
        (ingaende, belopp) => {
          const poster = belopp.map((v, index) =>
            verifikat(index + 1, '2026-01-09', [
              ['1930', String(v / 100)],
              ['3010', String(-v / 100)],
            ]),
          );
          const utdrag = kontoutdrag(kontot, ingaende, poster);
          expect(utdrag.utgaende).toBe(
            sum([ingaende, ...utdrag.rader.map((rad) => rad.belopp)]),
          );
        },
      ),
    );
  });
});

describe('beroradaKonton', () => {
  it('names every account a set of verifikat touched, once each', () => {
    const konton = beroradaKonton([
      verifikat(1, '2026-01-09', [
        ['2013', '-520.31'],
        ['2640', '104.06'],
        ['4010', '416.25'],
      ]),
      verifikat(2, '2026-01-16', [
        ['1930', '-249.00'],
        ['5420', '249.00'],
      ]),
    ]);

    expect([...konton].sort()).toEqual(['1930', '2013', '2640', '4010', '5420']);
  });
});
