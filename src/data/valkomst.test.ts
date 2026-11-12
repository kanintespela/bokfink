import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { uuidv7 } from '../domain/id/uuidv7';
import { datum } from '../domain/tid/datum';
import { fastKlocka } from '../domain/tid/klocka';
import { BOK_ID_NYCKEL, BOK_PROFIL_NYCKEL, lasBransch } from './bokidentitet';
import { lasTillstand } from './bokforing';
import { BokfinkDatabase } from './db';
import type { Skrivkontext } from './kommandon';
import { FORENINGENS_GRUNDKONTON, forberedBokforing, GRUNDKONTON } from './uppstart';
import {
  genomforValkomst,
  hoppaOverValkomst,
  skaVisaValkomst,
  ValkomstEjMojligError,
} from './valkomst';
import { skrivKonto } from './kommandon';
import { skapaKonto } from '../domain/konto/konto';

let raknare = 0;
let klockslag = 1_788_554_000_000;
const kontext: Skrivkontext = {
  enhet: 'enhet-a',
  nu: () => '2026-11-12T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(5)),
};
const IDAG = fastKlocka(datum('2026-11-12'));

async function blankBok(): Promise<BokfinkDatabase> {
  const db = new BokfinkDatabase(`kontera-valkomst-${(raknare += 1)}`);
  await db.open();
  await forberedBokforing(db, kontext, IDAG);
  return db;
}

const kontonummer = async (db: BokfinkDatabase) =>
  [...(await lasTillstand(db)).konton.keys()].map(String).sort();

describe('skaVisaValkomst', () => {
  it('shows for a blank first book', async () => {
    expect(await skaVisaValkomst(await blankBok())).toBe(true);
  });

  it('does not show once it has been put aside', async () => {
    const db = await blankBok();
    await hoppaOverValkomst(db);
    expect(await skaVisaValkomst(db)).toBe(false);
  });

  it('does not show for a book that has been given an account of its own', async () => {
    const db = await blankBok();
    await skrivKonto(db, kontext, skapaKonto({ nummer: '6071', namn: 'Representation' }));
    expect(await skaVisaValkomst(db)).toBe(false);
  });

  it('does not show for any book but the first', async () => {
    const db = await blankBok();
    await db.setMeta(BOK_ID_NYCKEL, 'en-annan-bok');
    expect(await skaVisaValkomst(db)).toBe(false);
  });
});

describe('genomforValkomst', () => {
  it('keeps the firm accounts and records the moms period for a firm', async () => {
    const db = await blankBok();
    await genomforValkomst(db, kontext, IDAG, {
      profil: 'enskild_firma',
      momsregistrerad: true,
      momsperiod: 'manad',
    });
    expect(await kontonummer(db)).toEqual(GRUNDKONTON.map((k) => k.nummer).sort());
    expect(await db.getMeta('momsperiod')).toBe('manad');
    expect(await skaVisaValkomst(db)).toBe(false);
  });

  it('records what a firm does, and an older book without one is a farm', async () => {
    const db = await blankBok();
    expect(await lasBransch(db)).toBe('gard');
    await genomforValkomst(db, kontext, IDAG, {
      profil: 'enskild_firma',
      momsregistrerad: true,
      momsperiod: 'kvartal',
      bransch: 'hantverk',
    });
    expect(await lasBransch(db)).toBe('hantverk');
  });

  it('records no trade for an association', async () => {
    const db = await blankBok();
    await genomforValkomst(db, kontext, IDAG, {
      profil: 'forening',
      momsregistrerad: false,
      momsperiod: 'kvartal',
      bransch: 'handel',
    });
    expect(await lasBransch(db)).toBe('gard');
  });

  it("swaps the firm's starter accounts for the association's", async () => {
    const db = await blankBok();
    await genomforValkomst(db, kontext, IDAG, {
      profil: 'forening',
      momsregistrerad: false,
      momsperiod: 'kvartal',
    });
    expect(await db.getMeta(BOK_PROFIL_NYCKEL)).toBe('forening');
    expect(await kontonummer(db)).toEqual(
      FORENINGENS_GRUNDKONTON.map((k) => k.nummer).sort(),
    );
    expect(await db.getMeta('momsregistrerad')).toBe(false);
    // Still a year to book in, which the swap has to put back.
    expect((await lasTillstand(db)).rakenskapsar.size).toBe(1);
  });

  it('records that an association is registered for moms', async () => {
    const db = await blankBok();
    await genomforValkomst(db, kontext, IDAG, {
      profil: 'forening',
      momsregistrerad: true,
      momsperiod: 'ar',
    });
    expect(await db.getMeta('momsregistrerad')).toBe(true);
    expect(await db.getMeta('momsperiod')).toBe('ar');
  });

  it('refuses, and changes nothing, once the book holds anything of its own', async () => {
    const db = await blankBok();
    await skrivKonto(db, kontext, skapaKonto({ nummer: '6071', namn: 'Representation' }));
    await expect(
      genomforValkomst(db, kontext, IDAG, {
        profil: 'forening',
        momsregistrerad: false,
        momsperiod: 'kvartal',
      }),
    ).rejects.toBeInstanceOf(ValkomstEjMojligError);
    expect(await db.getMeta(BOK_PROFIL_NYCKEL)).toBeUndefined();
    expect(await kontonummer(db)).toContain('6071');
  });
});
