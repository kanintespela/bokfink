import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { BOK_ID_NYCKEL, lasBokId, URSPRUNGLIG_BOK } from './bokidentitet';
import {
  Bokregister,
  bytNamnPaBok,
  granskaBoknamn,
  lasBocker,
  LANGSTA_BOKNAMN,
  OgiltigtBoknamnError,
  skapaBok,
  URSPRUNGLIG_DATABAS,
  valjBok,
  type Bok,
  type Registerkontext,
} from './bokregister';
import { KonteraDatabase } from './db';

let raknare = 0;
let idRaknare = 0;

const kontext: Registerkontext = {
  nu: () => `2026-10-22T10:00:${String(idRaknare).padStart(2, '0')}.000Z`,
  nyttId: () => `bok-${(idRaknare += 1)}`,
};

const bok = (namn: string, id = namn): Bok => ({
  id,
  namn,
  databas: `db-${id}`,
  skapad: '2026-10-22T10:00:00.000Z',
});

describe('granskaBoknamn', () => {
  it('trims the name and folds its inner spaces', () => {
    expect(granskaBoknamn('  Kristvalla   bygdegård ', [])).toBe('Kristvalla bygdegård');
  });

  it('refuses an empty name', () => {
    expect(() => granskaBoknamn('   ', [])).toThrow(OgiltigtBoknamnError);
  });

  it('accepts the longest name and refuses one character more', () => {
    expect(granskaBoknamn('x'.repeat(LANGSTA_BOKNAMN), [])).toHaveLength(LANGSTA_BOKNAMN);
    expect(() => granskaBoknamn('x'.repeat(LANGSTA_BOKNAMN + 1), [])).toThrow(
      OgiltigtBoknamnError,
    );
  });

  it("refuses another book's name, whatever its case", () => {
    expect(() => granskaBoknamn('FÖRENINGEN', [bok('Föreningen')])).toThrow(
      'Det finns redan en bok som heter Föreningen.',
    );
  });

  it('lets a book keep its own name in another case', () => {
    expect(granskaBoknamn('föreningen', [bok('Föreningen', 'f')], 'f')).toBe(
      'föreningen',
    );
  });
});

describe('bokregistret', () => {
  let register: Bokregister;

  beforeEach(() => {
    register = new Bokregister(`kontera-bocker-test-${(raknare += 1)}`);
  });

  it('starts with the original book, open, in the database it always had', async () => {
    const { bocker, aktiv } = await lasBocker(register, kontext);

    expect(bocker).toHaveLength(1);
    expect(aktiv).toMatchObject({
      id: URSPRUNGLIG_BOK,
      namn: 'Min bokföring',
      databas: URSPRUNGLIG_DATABAS,
    });
    // Registered once, however often it is read.
    await lasBocker(register, kontext);
    expect(await register.bocker.count()).toBe(1);
  });

  it('creates a book in a database of its own that knows which book it is', async () => {
    const forening = await skapaBok(register, kontext, 'Bygdegårdsföreningen');

    expect(forening.databas).not.toBe(URSPRUNGLIG_DATABAS);
    const db = new KonteraDatabase(forening.databas);
    expect(await lasBokId(db)).toBe(forening.id);
    expect(await db.getMeta(BOK_ID_NYCKEL)).toBe(forening.id);
    db.close();

    const { bocker, aktiv } = await lasBocker(register, kontext);
    expect(bocker.map((kandidat) => kandidat.namn)).toEqual([
      'Min bokföring',
      'Bygdegårdsföreningen',
    ]);
    // Creating a book does not open it; choosing does.
    expect(aktiv.databas).toBe(URSPRUNGLIG_DATABAS);
  });

  it('refuses a second book with a name already taken', async () => {
    await expect(skapaBok(register, kontext, 'min bokföring')).rejects.toBeInstanceOf(
      OgiltigtBoknamnError,
    );
    expect(await register.bocker.count()).toBe(1);
  });

  it('remembers the chosen book', async () => {
    const forening = await skapaBok(register, kontext, 'Föreningen');
    await valjBok(register, forening.id);

    expect((await lasBocker(register, kontext)).aktiv.id).toBe(forening.id);
  });

  it('refuses to choose a book that is not there', async () => {
    await expect(valjBok(register, 'saknas')).rejects.toThrow(
      'Boken saknas finns inte på den här enheten.',
    );
  });

  it('opens the original book when the chosen one has gone from the register', async () => {
    await register.val.put({ key: 'aktiv', value: 'borta' });

    expect((await lasBocker(register, kontext)).aktiv.id).toBe(URSPRUNGLIG_BOK);
  });

  it('renames a book and keeps everything else about it', async () => {
    await lasBocker(register, kontext);
    const ny = await bytNamnPaBok(register, kontext, URSPRUNGLIG_BOK, 'Firman');

    expect(ny).toMatchObject({ id: URSPRUNGLIG_BOK, namn: 'Firman' });
    expect((await lasBocker(register, kontext)).aktiv.namn).toBe('Firman');
  });

  it('finds a book database the register has lost, and leaves other databases alone', async () => {
    const { bocker } = await lasBocker(register, {
      ...kontext,
      databaser: async () => [
        URSPRUNGLIG_DATABAS,
        'kontera-bok-019a0000-0000-7000-8000-000000000001',
        'kontera-bocker',
        'något-annat',
      ],
    });

    expect(bocker.map((kandidat) => [kandidat.id, kandidat.namn])).toEqual([
      [URSPRUNGLIG_BOK, 'Min bokföring'],
      ['019a0000-0000-7000-8000-000000000001', 'Återfunnen bok 1'],
    ]);
  });
});
