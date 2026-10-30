import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  BOK_ID_NYCKEL,
  BOK_PROFIL_NYCKEL,
  lasBokId,
  lasBokprofil,
  URSPRUNGLIG_BOK,
} from './bokidentitet';
import {
  Bokregister,
  bytNamnPaBok,
  filprefix,
  granskaBoknamn,
  KanInteTasBortError,
  lasBokinnehall,
  lasBocker,
  LANGSTA_BOKNAMN,
  OgiltigtBoknamnError,
  skapaBok,
  tabortBok,
  URSPRUNGLIG_DATABAS,
  valjBok,
  type Bok,
  type Registerkontext,
} from './bokregister';
import { KonteraDatabase } from './db';
import { uuidv7 } from '../domain/id/uuidv7';
import { forberedBokforing } from './uppstart';
import { bokforUtkast, skrivKonto, type Skrivkontext } from './kommandon';
import { skyddaBokfordaVerifikat } from './bokforing';
import { skapaUtkast } from '../domain/verifikat/verifikat';
import { verifikatserie } from '../domain/verifikat/serie';
import { fastKlocka } from '../domain/tid/klocka';
import { datum } from '../domain/tid/datum';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import { oreFromKronor } from '../domain/belopp/ore';

let raknare = 0;
let idRaknare = 0;

const kontext: Registerkontext = {
  nu: () => `2026-10-22T10:00:${String(idRaknare).padStart(2, '0')}.000Z`,
  nyttId: () => `bok-${(idRaknare += 1)}`,
};

const skrivkontext: Skrivkontext = {
  enhet: 'enhet-a',
  nu: () => '2026-10-30T08:00:00.000Z',
  nyttId: () => uuidv7(1_788_554_000_000 + (idRaknare += 1), new Uint8Array(10).fill(6)),
};

const bok = (namn: string, id = namn): Bok => ({
  id,
  namn,
  databas: `db-${id}`,
  skapad: '2026-10-22T10:00:00.000Z',
});

describe('granskaBoknamn', () => {
  it('trims the name and folds its inner spaces', () => {
    expect(granskaBoknamn('  Exempelbygden   bygdegård ', [])).toBe(
      'Exempelbygden bygdegård',
    );
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

describe('filprefix', () => {
  it('keeps the names the original books have always had', () => {
    expect(filprefix({ ...bok('Firman'), databas: URSPRUNGLIG_DATABAS })).toBe('kontera');
  });

  it("adds another book's name, without accents or spaces", () => {
    expect(filprefix(bok('Exempelbygdens Bygdegårdsförening'))).toBe(
      'kontera-exempelbygdens-bygdegardsforening',
    );
  });

  it('falls back to a plain name when nothing in the name survives', () => {
    expect(filprefix(bok('!!!'))).toBe('kontera-bok');
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
    const forening = await skapaBok(
      register,
      kontext,
      'Bygdegårdsföreningen',
      'forening',
    );

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

  it('writes the profile it was given into the book, and nowhere else', async () => {
    const forening = await skapaBok(register, kontext, 'Föreningen', 'forening');
    const firma = await skapaBok(register, kontext, 'Firman', 'enskild_firma');

    for (const [bok, profil] of [
      [forening, 'forening'],
      [firma, 'enskild_firma'],
    ] as const) {
      const db = new KonteraDatabase(bok.databas);
      expect(await db.getMeta(BOK_PROFIL_NYCKEL)).toBe(profil);
      expect(await lasBokprofil(db)).toBe(profil);
      db.close();
    }
    // The register knows names and databases, not what kind of book it is.
    expect(Object.keys(forening)).not.toContain('profil');
  });

  it('takes the original book, which recorded no profile, for a firm', async () => {
    const db = new KonteraDatabase(URSPRUNGLIG_DATABAS);
    expect(await db.getMeta(BOK_PROFIL_NYCKEL)).toBeUndefined();
    expect(await lasBokprofil(db)).toBe('enskild_firma');
    db.close();
  });

  it('refuses a second book with a name already taken', async () => {
    await expect(
      skapaBok(register, kontext, 'min bokföring', 'enskild_firma'),
    ).rejects.toBeInstanceOf(OgiltigtBoknamnError);
    expect(await register.bocker.count()).toBe(1);
  });

  it('remembers the chosen book', async () => {
    const forening = await skapaBok(register, kontext, 'Föreningen', 'forening');
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

describe('lasBokinnehall och tabortBok', () => {
  let register: Bokregister;
  beforeEach(async () => {
    register = new Bokregister(`kontera-bocker-ta-bort-${(raknare += 1)}`);
    await register.open();
  });

  const bokforAlltSomEnNybok = async (databas: string) => {
    const db = new KonteraDatabase(databas);
    skyddaBokfordaVerifikat(db);
    await db.open();
    await forberedBokforing(db, skrivkontext, fastKlocka(datum('2026-10-30')));
    return db;
  };

  it('takes a book nobody has used for empty', async () => {
    const bok = await skapaBok(register, kontext, 'Tillfällig', 'forening');
    const db = await bokforAlltSomEnNybok(bok.databas);
    expect(await lasBokinnehall(db)).toEqual({
      tom: true,
      verifikat: 0,
      utkast: 0,
      underlag: 0,
      synkad: false,
    });
    db.close();
  });

  it('takes a book with a booking, a receipt or an account of its own for not empty', async () => {
    const bok = await skapaBok(register, kontext, 'Använd', 'forening');
    const db = await bokforAlltSomEnNybok(bok.databas);
    await skrivKonto(
      db,
      skrivkontext,
      skapaKonto({ nummer: '5999', namn: 'Eget konto' }),
    );
    const innehall = await lasBokinnehall(db);
    expect(innehall.tom).toBe(false);
    db.close();
  });

  it('counts what is in it, and says when it syncs', async () => {
    const bok = await skapaBok(register, kontext, 'Synkad', 'enskild_firma');
    const db = await bokforAlltSomEnNybok(bok.databas);
    await db.setMeta('synk.inloggning', {
      url: 'https://synk.example',
      token: 't',
      epost: 'a@example.se',
    });
    await bokforUtkast(
      db,
      skrivkontext,
      skapaUtkast({
        id: skrivkontext.nyttId!(),
        datum: datum('2026-10-30'),
        beskrivning: 'x',
        konteringar: [
          { konto: kontonummer('1930'), belopp: oreFromKronor('100') },
          { konto: kontonummer('3000'), belopp: oreFromKronor('-100') },
        ],
      }),
      verifikatserie('A'),
    );
    const innehall = await lasBokinnehall(db);
    expect(innehall).toMatchObject({ tom: false, verifikat: 1, synkad: true });
    db.close();
  });

  it('takes the database and the entry away together', async () => {
    const bok = await skapaBok(register, kontext, 'Tillfällig', 'forening');
    const db = await bokforAlltSomEnNybok(bok.databas);
    db.close();

    await tabortBok(register, kontext, bok.id);

    expect((await lasBocker(register, kontext)).bocker.map((post) => post.namn)).toEqual([
      'Min bokföring',
    ]);
    expect(await Dexie.getDatabaseNames()).not.toContain(bok.databas);
  });

  it('opens the original book when the open one goes', async () => {
    const bok = await skapaBok(register, kontext, 'Öppen', 'forening');
    await valjBok(register, bok.id);
    await tabortBok(register, kontext, bok.id);

    expect((await lasBocker(register, kontext)).aktiv.databas).toBe(URSPRUNGLIG_DATABAS);
  });

  it('leaves the open choice alone when another book goes', async () => {
    const kvar = await skapaBok(register, kontext, 'Kvar', 'forening');
    const bort = await skapaBok(register, kontext, 'Bort', 'forening');
    await valjBok(register, kvar.id);
    await tabortBok(register, kontext, bort.id);

    expect((await lasBocker(register, kontext)).aktiv.id).toBe(kvar.id);
  });

  it('refuses the original book, which would only be put back', async () => {
    const { bocker } = await lasBocker(register, kontext);
    await expect(tabortBok(register, kontext, bocker[0]!.id)).rejects.toBeInstanceOf(
      KanInteTasBortError,
    );
    expect((await lasBocker(register, kontext)).bocker).toHaveLength(1);
  });

  it('says so about a book that is not there', async () => {
    await expect(tabortBok(register, kontext, 'finns-inte')).rejects.toThrow(
      'finns inte på den här enheten',
    );
  });
});
