import { describe, expect, it } from 'vitest';

import { oreFromKronor, sum } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import { kontonummer } from '../konto/konto';
import { datum } from '../tid/datum';
import { verifikatserie } from '../verifikat/serie';
import { bokfor, skapaUtkast, type BokfortVerifikat } from '../verifikat/verifikat';
import { arKostnadskonto, fordelningsKonteringar, kostnaderPerKonto } from './fordelning';

const kr = oreFromKronor;
const P = '019b76da-a800-7000-8000-0000000000a1' as Uuid;
const Q = '019b76da-a800-7000-8000-0000000000a2' as Uuid;
const AR = { start: datum('2026-01-01'), slut: datum('2026-12-31') };

let nummer = 0;
function bokford(
  datumtext: string,
  rader: readonly { konto: string; belopp: string; projekt?: Uuid }[],
): BokfortVerifikat {
  nummer += 1;
  return bokfor(
    skapaUtkast({
      id: `019b76da-a800-7000-8000-${String(nummer).padStart(12, '0')}` as Uuid,
      datum: datum(datumtext),
      beskrivning: 'Test',
      konteringar: rader.map(({ konto, belopp, projekt }) => ({
        konto: kontonummer(konto),
        belopp: kr(belopp),
        ...(projekt === undefined ? {} : { projekt }),
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

/*
 * Electricity, 5020, over 2026: 1 000 kr on no project, 600 kr on P and 400 kr on
 * Q, 2 000 kr in all. The bank rows are not cost accounts and are left out.
 */
const BOKFORING = [
  bokford('2026-02-01', [
    { konto: '5020', belopp: '1000' },
    { konto: '1930', belopp: '-1000' },
  ]),
  bokford('2026-03-01', [
    { konto: '5020', belopp: '600', projekt: P },
    { konto: '1930', belopp: '-600' },
  ]),
  bokford('2026-04-01', [
    { konto: '5020', belopp: '400', projekt: Q },
    { konto: '1930', belopp: '-400' },
  ]),
  bokford('2025-12-31', [
    { konto: '5020', belopp: '999' },
    { konto: '1930', belopp: '-999' },
  ]),
];

describe('kostnaderPerKonto', () => {
  it('splits a cost account into what is on projects and what is common', () => {
    const [el, ...resten] = kostnaderPerKonto(BOKFORING, AR);

    expect(resten).toEqual([]);
    expect(el).toMatchObject({
      konto: '5020',
      totalt: kr('2000'),
      medProjekt: kr('1000'),
      utanProjekt: kr('1000'),
    });
    expect([...el!.perProjekt]).toEqual([
      [P, kr('600')],
      [Q, kr('400')],
    ]);
  });

  it('leaves out other years and accounts that are not cost accounts', () => {
    expect(kostnaderPerKonto(BOKFORING, AR).map((post) => post.konto)).toEqual(['5020']);
    expect(
      kostnaderPerKonto(BOKFORING, {
        start: datum('2025-01-01'),
        slut: datum('2025-12-31'),
      })[0]?.totalt,
    ).toBe(kr('999'));
  });

  it('takes a cost moved onto a project out of the common cost and nothing else', () => {
    const flytt = bokford(
      '2026-12-31',
      fordelningsKonteringar({
        konto: kontonummer('5020'),
        belopp: kr('300'),
        projekt: P,
        riktning: 'till_projekt',
      }).map((rad) => ({
        konto: rad.konto,
        belopp: String(rad.belopp / 100),
        ...(rad.projekt === undefined ? {} : { projekt: rad.projekt }),
      })),
    );
    const [el] = kostnaderPerKonto([...BOKFORING, flytt], AR);

    // The account is where it was; P has 300 kr more and the common cost 300 kr less.
    expect(el?.totalt).toBe(kr('2000'));
    expect(el?.utanProjekt).toBe(kr('700'));
    expect(el?.perProjekt.get(P)).toBe(kr('900'));
    expect(el?.perProjekt.get(Q)).toBe(kr('400'));
  });
});

describe('fordelningsKonteringar', () => {
  const konto = kontonummer('5020');

  it('moves an amount from the common cost to a project, on the same account', () => {
    const rader = fordelningsKonteringar({
      konto,
      belopp: kr('300'),
      projekt: P,
      riktning: 'till_projekt',
    });

    expect(rader).toEqual([
      { konto, belopp: kr('300'), projekt: P },
      { konto, belopp: kr('-300') },
    ]);
    // It balances, and the account comes to what it did before.
    expect(sum(rader.map((rad) => rad.belopp))).toBe(0);
  });

  it('moves it back the other way with the project on the credit side', () => {
    expect(
      fordelningsKonteringar({
        konto,
        belopp: kr('300'),
        projekt: P,
        riktning: 'fran_projekt',
      }),
    ).toEqual([
      { konto, belopp: kr('300') },
      { konto, belopp: kr('-300'), projekt: P },
    ]);
  });

  it('refuses an account that is not a cost account, and an amount of nothing or less', () => {
    const bas = { projekt: P, riktning: 'till_projekt' } as const;
    expect(() =>
      fordelningsKonteringar({ ...bas, konto: kontonummer('1930'), belopp: kr('1') }),
    ).toThrow(RangeError);
    expect(() =>
      fordelningsKonteringar({ ...bas, konto: kontonummer('3010'), belopp: kr('1') }),
    ).toThrow(RangeError);
    expect(() => fordelningsKonteringar({ ...bas, konto, belopp: kr('0') })).toThrow(
      RangeError,
    );
    expect(() => fordelningsKonteringar({ ...bas, konto, belopp: kr('-5') })).toThrow(
      RangeError,
    );
  });

  it('counts classes 4 to 7 as cost accounts', () => {
    expect(
      ['4000', '5020', '6100', '7010'].every((nr) => arKostnadskonto(kontonummer(nr))),
    ).toBe(true);
    expect(['1930', '3010', '8310'].some((nr) => arKostnadskonto(kontonummer(nr)))).toBe(
      false,
    );
  });
});
