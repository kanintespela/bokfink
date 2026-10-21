import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import type { Resultatrad } from '../domain/bokslut/forenkladArsbokslut';
import { kontonummer } from '../domain/konto/konto';
import { KonteraDatabase } from './db';
import { lasRutval, sparaRutval } from './rutval';

let raknare = 0;

const nyDb = async () => {
  const db = new KonteraDatabase(`kontera-rutval-${(raknare += 1)}`);
  await db.open();
  return db;
};

describe('lasRutval och sparaRutval', () => {
  it('är tomt från början', async () => {
    const db = await nyDb();
    expect((await lasRutval(db)).size).toBe(0);
  });

  it('minns ett val och glömmer det igen', async () => {
    const db = await nyDb();
    await sparaRutval(db, kontonummer('3740'), 'R1');
    await sparaRutval(db, kontonummer('7720'), 'R9');
    expect(await lasRutval(db)).toEqual(
      new Map([
        [kontonummer('3740'), 'R1'],
        [kontonummer('7720'), 'R9'],
      ]),
    );

    await sparaRutval(db, kontonummer('3740'), undefined);
    expect(await lasRutval(db)).toEqual(new Map([[kontonummer('7720'), 'R9']]));
  });

  it('vägrar spara en ruta som inte är ett av BAS alternativ', async () => {
    const db = await nyDb();
    await expect(
      sparaRutval(db, kontonummer('3740'), 'R6' as Resultatrad),
    ).rejects.toThrow(TypeError);
    await expect(sparaRutval(db, kontonummer('3010'), 'R1')).rejects.toThrow(TypeError);
  });

  it('läser förbi ogiltiga poster, så att kontot frågar igen', async () => {
    const db = await nyDb();
    await db.setMeta('bokslut.rutval', {
      '3740': 'R1',
      '3010': 'R1',
      '7720': 'R6',
      skräp: 'R2',
    });
    expect(await lasRutval(db)).toEqual(new Map([[kontonummer('3740'), 'R1']]));
  });
});
