import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import type { Uuid } from '../domain/id/uuidv7';
import type { Justeringsrad } from '../domain/skatt/nebilaga';
import { KonteraDatabase } from './db';
import {
  lasDeklarant,
  lasNejusteringar,
  sparaDeklarant,
  sparaNejusteringar,
} from './nebilaga';

let raknare = 0;

const nyDb = async () => {
  const db = new KonteraDatabase(`kontera-nebilaga-${(raknare += 1)}`);
  await db.open();
  return db;
};

const AR_2025 = '019b76da-a800-7000-8000-000000002025' as Uuid;
const AR_2026 = '019b76da-a800-7000-8000-000000002026' as Uuid;

describe('deklarantuppgifter', () => {
  it('är tomma från början och minns det som sparats', async () => {
    const db = await nyDb();
    expect((await lasDeklarant(db)).personnummer).toBe('');

    const uppgifter = {
      personnummer: '191212121212',
      namn: 'Test Testsson',
      adress: 'Gården 1',
      postnummer: '36430',
      postort: 'Åseda',
      verksamhetensArt: 'Fårskötsel',
    };
    await sparaDeklarant(db, uppgifter);
    expect(await lasDeklarant(db)).toEqual(uppgifter);
  });

  it('läser förbi fält som inte är text', async () => {
    const db = await nyDb();
    await db.setMeta('ne.deklarant', { namn: 42, postort: 'Åseda' });
    const uppgifter = await lasDeklarant(db);
    expect(uppgifter.namn).toBe('');
    expect(uppgifter.postort).toBe('Åseda');
  });
});

describe('NE-justeringar', () => {
  it('sparas per år och glömmer nollor', async () => {
    const db = await nyDb();
    await sparaNejusteringar(db, AR_2025, {
      R24: oreFromKronor('35565'),
      R13: oreFromKronor('0'),
    });
    expect(await lasNejusteringar(db, AR_2025)).toEqual({ R24: oreFromKronor('35565') });
    expect(await lasNejusteringar(db, AR_2026)).toEqual({});
  });

  it('vägrar spara en rad som inte finns på blanketten', async () => {
    const db = await nyDb();
    await expect(
      sparaNejusteringar(db, AR_2025, { R99: oreFromKronor('1') } as Partial<
        Record<Justeringsrad, never>
      >),
    ).rejects.toThrow(TypeError);
  });

  it('läser förbi okända rader och belopp som inte är heltal öre', async () => {
    const db = await nyDb();
    await db.setMeta(`ne.justeringar.${AR_2025}`, {
      R24: 100,
      R13: 1.5,
      R99: 100,
      R43: 'x',
    });
    expect(await lasNejusteringar(db, AR_2025)).toEqual({ R24: 100 });
  });
});
