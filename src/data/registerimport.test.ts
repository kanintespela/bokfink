import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { tolkaRegisterfil } from '../domain/anlaggning/registerfil';
import { oreFromKronor } from '../domain/belopp/ore';
import { uuidv7 } from '../domain/id/uuidv7';
import { lasTillstand } from './bokforing';
import { BokfinkDatabase } from './db';
import { fastighetsavskrivningsforslag } from './fastighet';
import type { Skrivkontext } from './kommandon';
import { genomforRegisterimport, planeraRegisterimport } from './registerimport';

let raknare = 0;
let klockslag = 1_788_554_000_000;

const kontext: Skrivkontext = {
  enhet: 'enhet-a',
  nu: () => '2026-11-15T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(3)),
};

/*
 * A farm's register as it stood in a spreadsheet: a building written off at
 * 4 % for three years (3 × 3 109,36 = 9 328,08), forest and land that are
 * never written off, and two machines.
 */
const FIL = tolkaRegisterfil(
  JSON.stringify({
    format: 'bokfink-anlaggningsregister',
    version: 1,
    inventarier: [
      {
        benamning: 'Woodland Mills HM126E',
        anskaffningsdatum: '2022-01-01',
        anskaffningsvarde: '38100',
        nyttjandeperiod: 5,
      },
      {
        benamning: 'John Deere 2120',
        anskaffningsdatum: '2024-04-20',
        anskaffningsvarde: '50000',
        nyttjandeperiod: 5,
      },
    ],
    fastighet: [
      {
        benamning: 'B2 ekonomibyggnader',
        anskaffningsdatum: '2011-12-01',
        anskaffningsvarde: '77734',
        kategori: 'byggnad',
        byggnadstyp: 'ekonomibyggnad_ovrig',
        ackumuleradAvskrivning: '9328,08',
      },
      {
        benamning: 'B3 skog',
        anskaffningsdatum: '2011-12-01',
        anskaffningsvarde: '265922',
        kategori: 'skog',
      },
    ],
  }),
);

describe('reading a register file into the books', () => {
  let db: BokfinkDatabase;

  beforeEach(async () => {
    db = new BokfinkDatabase(`kontera-registerimport-${(raknare += 1)}`);
    await db.open();
  });

  it('writes nothing while it is only being planned', async () => {
    const plan = await planeraRegisterimport(db, FIL);

    expect(plan.inventarier).toHaveLength(2);
    expect(plan.fastighet).toHaveLength(2);
    expect(plan.finnsRedan).toEqual([]);
    const tillstand = await lasTillstand(db);
    expect(tillstand.anlaggningar.size + tillstand.fastigheter.size).toBe(0);
  });

  it('registers each entry in the register it belongs to', async () => {
    const antal = await genomforRegisterimport(
      db,
      kontext,
      await planeraRegisterimport(db, FIL),
    );

    expect(antal).toBe(4);
    const tillstand = await lasTillstand(db);
    expect(
      [...tillstand.anlaggningar.values()].map((post) => post.benamning).sort(),
    ).toEqual(['John Deere 2120', 'Woodland Mills HM126E']);
    expect(
      [...tillstand.fastigheter.values()].map((post) => post.benamning).sort(),
    ).toEqual(['B2 ekonomibyggnader', 'B3 skog']);
  });

  /*
   * What the import is for: the building starts where the ledger has it,
   * 77 734 − 9 328,08 = 68 405,92 kr, and next year's proposal is the same
   * 4 % of the cost as every year before, 3 109,36 kr.
   */
  it('starts an older building from what is already written off', async () => {
    await genomforRegisterimport(db, kontext, await planeraRegisterimport(db, FIL));

    const forslag = (await fastighetsavskrivningsforslag(db)).find(
      (post) => post.tillgang.benamning === 'B2 ekonomibyggnader',
    );

    expect(forslag?.bokfortVardeInnan).toBe(oreFromKronor('68405.92'));
    expect(forslag?.forslag).toBe(oreFromKronor('3109.36'));
  });

  it('gives one of everything when the same file is read twice', async () => {
    await genomforRegisterimport(db, kontext, await planeraRegisterimport(db, FIL));

    const igen = await planeraRegisterimport(db, FIL);
    expect(igen.inventarier).toEqual([]);
    expect(igen.fastighet).toEqual([]);
    expect(igen.finnsRedan).toHaveLength(4);
    expect(await genomforRegisterimport(db, kontext, igen)).toBe(0);

    const tillstand = await lasTillstand(db);
    expect(tillstand.anlaggningar.size + tillstand.fastigheter.size).toBe(4);
  });

  it('takes one of an asset the file lists twice', async () => {
    const dubbel = {
      ...FIL,
      inventarier: [...FIL.inventarier, FIL.inventarier[0]!],
    };

    const plan = await planeraRegisterimport(db, dubbel);

    expect(plan.inventarier).toHaveLength(2);
    expect(plan.finnsRedan).toEqual(['Woodland Mills HM126E']);
  });
});
