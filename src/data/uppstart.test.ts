import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { allaLov, kontonITradet } from '../domain/beslutstrad/beslutstrad';
import { FORENINGSTRAD } from '../domain/beslutstrad/foreningstrad';
import type { Handelse } from '../domain/handelse/handelse';
import type { Uuid } from '../domain/id/uuidv7';
import { skapaKonto } from '../domain/konto/konto';
import { uuidv7 } from '../domain/id/uuidv7';
import { datum } from '../domain/tid/datum';
import { fastKlocka } from '../domain/tid/klocka';
import { BOK_PROFIL_NYCKEL } from './bokidentitet';
import { lasTillstand } from './bokforing';
import { KonteraDatabase } from './db';
import type { Skrivkontext } from './kommandon';
import {
  arEnbartStartdata,
  forberedBokforing,
  FORENINGENS_GRUNDKONTON,
  GRUNDKONTON,
  grundkontonFor,
} from './uppstart';

const huvud = (n: number) => ({
  id: `019b76da-a800-7000-8000-${String(n).padStart(12, '0')}` as Uuid,
  enhet: 'nya',
  tidpunkt: '2026-09-13T08:00:00.000Z',
});

const kontoHandelse = (n: number, nummer: string, namn: string): Handelse => ({
  ...huvud(n),
  typ: 'konto.skapat',
  konto: skapaKonto({ nummer, namn }),
});

describe('arEnbartStartdata', () => {
  it('recognises the BAS K1 starter accounts', () => {
    const logg = GRUNDKONTON.map((utkast, index) => ({
      ...huvud(index),
      typ: 'konto.skapat' as const,
      konto: skapaKonto(utkast),
    }));
    expect(arEnbartStartdata(logg)).toBe(true);
  });

  // A device set up before the switch to BAS K1, and never used since.
  it('still recognises the starter accounts earlier versions wrote', () => {
    expect(
      arEnbartStartdata([
        kontoHandelse(1, '1630', 'Avräkning för skatter och avgifter (skattekonto)'),
        kontoHandelse(2, '4010', 'Inköp av material och varor'),
      ]),
    ).toBe(true);
  });

  it('does not take an account someone named themselves for a starter one', () => {
    expect(arEnbartStartdata([kontoHandelse(1, '3000', 'Försäljning av lamm')])).toBe(
      false,
    );
  });
});

describe('GRUNDKONTON', () => {
  // A leaf that books on an account a new ledger lacks cannot be booked at all.
  it('holds every account the booking questions book on', () => {
    const grund = new Set(GRUNDKONTON.map((konto) => konto.nummer));
    expect([...kontonITradet()].filter((konto) => !grund.has(konto))).toEqual([]);
  });
});

describe('FORENINGENS_GRUNDKONTON', () => {
  it('has each number once, and a name for every one', () => {
    const nummer = FORENINGENS_GRUNDKONTON.map((konto) => konto.nummer);
    expect(new Set(nummer).size).toBe(nummer.length);
    expect(FORENINGENS_GRUNDKONTON.every((konto) => konto.namn.trim() !== '')).toBe(true);
  });

  it('keeps the accounts the booking engine itself books on', () => {
    const nummer = new Set(FORENINGENS_GRUNDKONTON.map((konto) => konto.nummer));
    // Every receipt's öresutjämning goes to 3740, and the year's result to 8999.
    expect(nummer.has('3740')).toBe(true);
    expect(nummer.has('8999')).toBe(true);
  });

  it('is what an association gets, and the K1 set is what a firm gets', () => {
    expect(grundkontonFor('forening')).toBe(FORENINGENS_GRUNDKONTON);
    expect(grundkontonFor('enskild_firma')).toBe(GRUNDKONTON);
  });

  it('is recognised as a starter set, so an unused association book can take a backup', () => {
    const logg = FORENINGENS_GRUNDKONTON.map((utkast, index) => ({
      ...huvud(index),
      typ: 'konto.skapat' as const,
      konto: skapaKonto(utkast),
    }));
    expect(arEnbartStartdata(logg)).toBe(true);
  });
});

describe('forberedBokforing och bokens profil', () => {
  let raknare = 0;
  let klockslag = 1_788_554_000_000;
  const nyDb = async () => {
    const db = new KonteraDatabase(`kontera-uppstart-${(raknare += 1)}`);
    await db.open();
    return db;
  };
  const kontext: Skrivkontext = {
    enhet: 'enhet-a',
    nu: () => '2026-10-30T08:00:00.000Z',
    nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(3)),
  };
  const IDAG = fastKlocka(datum('2026-10-30'));

  it("gives an association's book its own accounts and none of the firm's", async () => {
    const db = await nyDb();
    await db.setMeta(BOK_PROFIL_NYCKEL, 'forening');
    await forberedBokforing(db, kontext, IDAG);

    const konton = [...(await lasTillstand(db)).konton.keys()].map(String);
    expect(konton.sort()).toEqual(
      FORENINGENS_GRUNDKONTON.map((konto) => konto.nummer).sort(),
    );
    // Nothing that belongs to an owner: egna uttag and insättningar, the skattekonto.
    for (const agare of ['2012', '2013', '2017']) {
      expect(konton).not.toContain(agare);
    }
  });

  it("still gives a firm's book the BAS K1 set", async () => {
    const db = await nyDb();
    await forberedBokforing(db, kontext, IDAG);

    const konton = [...(await lasTillstand(db)).konton.keys()].map(String);
    expect(konton.sort()).toEqual(GRUNDKONTON.map((konto) => konto.nummer).sort());
  });
});

describe('FORENINGENS_GRUNDKONTON och trädet', () => {
  // A leaf that books on an account a new association's book lacks cannot be booked at all.
  it("holds every account the association's questions book on", () => {
    const grund = new Set(FORENINGENS_GRUNDKONTON.map((konto) => konto.nummer));
    const behovs = allaLov(FORENINGSTRAD).flatMap((lov) => [lov.konto, ...lov.betalsatt]);
    expect([...new Set(behovs)].filter((konto) => !grund.has(konto))).toEqual([]);
  });
});
