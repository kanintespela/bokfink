import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { lagervarde } from '../domain/lager/djurlager';
import { uuidv7 } from '../domain/id/uuidv7';
import { datum } from '../domain/tid/datum';
import {
  bokforLagerforandring,
  djurlagerinventeringar,
  registreraDjurlagerinventering,
} from './lager';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import { skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { verifikatserie } from '../domain/verifikat/serie';
import type { Uuid } from '../domain/id/uuidv7';
import { lasTillstand } from './bokforing';
import { skrivKonto, skrivRakenskapsar } from './kommandon';
import { KonteraDatabase } from './db';
import { skyddaBokfordaVerifikat } from './bokforing';

import type { Skrivkontext } from './kommandon';

let raknare = 0;
let klockslag = 1_788_554_000_000;

const nyDb = async () => {
  const db = new KonteraDatabase(`kontera-lager-${(raknare += 1)}`);
  skyddaBokfordaVerifikat(db);
  await db.open();
  return db;
};

const kontext: Skrivkontext = {
  enhet: 'enhet-a',
  nu: () => '2026-09-08T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(9)),
};

describe('registreraDjurlagerinventering', () => {
  it('registrerar en inventering och gör den läsbar via djurlagerinventeringar', async () => {
    const db = await nyDb();

    const inventering = await registreraDjurlagerinventering(db, kontext, {
      datum: datum('2026-12-31'),
      poster: [
        {
          djurslag: 'Tacka',
          antal: 5,
          genomsnittligProduktionsutgiftPerDjur: oreFromKronor('1100'),
          nettoforsaljningsvardePerDjur: oreFromKronor('2000'),
        },
      ],
    });

    const alla = await djurlagerinventeringar(db);
    expect(alla).toHaveLength(1);
    expect(alla[0]!.id).toBe(inventering.id);
    expect(lagervarde(alla[0]!)).toBe(oreFromKronor('4675'));
  });

  it('listar senaste inventeringen först', async () => {
    const db = await nyDb();

    await registreraDjurlagerinventering(db, kontext, {
      datum: datum('2025-12-31'),
      poster: [],
    });
    await registreraDjurlagerinventering(db, kontext, {
      datum: datum('2026-12-31'),
      poster: [],
    });

    const alla = await djurlagerinventeringar(db);
    expect(alla.map((i) => i.datum)).toEqual([datum('2026-12-31'), datum('2025-12-31')]);
  });
});

/*
 * K1 counts the change in stock into the year's cost (BFNAR 2006:1 punkt
 * 7.7 d), so the year-end count is booked once, on the balansdag, against
 * what the stock account already holds. Books kept on BAS K1 do this on
 * 1400 and 4900; older charts use 4990 for the same thing.
 */
describe('bokforLagerforandring', () => {
  const tacka = (antal: number) => ({
    djurslag: 'Tacka',
    antal,
    genomsnittligProduktionsutgiftPerDjur: oreFromKronor('1000'),
    nettoforsaljningsvardePerDjur: oreFromKronor('2000'),
  });

  async function medAr(ib: string) {
    const db = await nyDb();
    for (const [nummer, namn] of [
      ['1400', 'Lager'],
      ['4900', 'Förändring av lager'],
    ] as const) {
      await skrivKonto(db, kontext, skapaKonto({ nummer, namn }));
    }
    await skrivRakenskapsar(
      db,
      kontext,
      skapaRakenskapsar({
        id: '019b76da-a800-7000-8000-000000002026' as Uuid,
        start: datum('2026-01-01'),
        slut: datum('2026-12-31'),
        ingaendeBalanser: [
          { konto: kontonummer('1400'), belopp: oreFromKronor(ib) },
          { konto: kontonummer('2010'), belopp: oreFromKronor(`-${ib}`) },
        ],
      }),
    );
    return db;
  }

  it('books a rise in value as more stock and less cost', async () => {
    const db = await medAr('4600');
    // 20 ewes at 85 % of 1 000 = 17 000; the account holds 4 600.
    const inventering = await registreraDjurlagerinventering(db, kontext, {
      datum: datum('2026-12-31'),
      poster: [tacka(20)],
    });

    const verifikat = await bokforLagerforandring(
      db,
      kontext,
      inventering,
      verifikatserie('A'),
    );

    expect(verifikat.datum).toBe('2026-12-31');
    expect(verifikat.konteringar).toEqual([
      { konto: '1400', belopp: oreFromKronor('12400') },
      { konto: '4900', belopp: oreFromKronor('-12400') },
    ]);
  });

  it('books a fall in value the other way', async () => {
    const db = await medAr('17000');
    const inventering = await registreraDjurlagerinventering(db, kontext, {
      datum: datum('2026-12-31'),
      poster: [tacka(10)],
    });

    const verifikat = await bokforLagerforandring(
      db,
      kontext,
      inventering,
      verifikatserie('A'),
    );
    expect(verifikat.konteringar).toEqual([
      { konto: '4900', belopp: oreFromKronor('8500') },
      { konto: '1400', belopp: oreFromKronor('-8500') },
    ]);
  });

  it('says so when the stock account already holds the counted value', async () => {
    const db = await medAr('4600');
    const inventering = await registreraDjurlagerinventering(db, kontext, {
      datum: datum('2026-12-31'),
      poster: [tacka(20)],
    });
    await bokforLagerforandring(db, kontext, inventering, verifikatserie('A'));

    await expect(
      bokforLagerforandring(db, kontext, inventering, verifikatserie('A')),
    ).rejects.toThrow('redan');
    expect((await lasTillstand(db)).verifikat.size).toBe(1);
  });

  it('refuses a count that was not made on the balansdag', async () => {
    const db = await medAr('4600');
    const inventering = await registreraDjurlagerinventering(db, kontext, {
      datum: datum('2026-06-30'),
      poster: [tacka(20)],
    });

    await expect(
      bokforLagerforandring(db, kontext, inventering, verifikatserie('A')),
    ).rejects.toThrow('2026-12-31');
  });
});
