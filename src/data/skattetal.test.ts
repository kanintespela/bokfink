import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { KonteraDatabase } from './db';
import { lasEgnaPrisbasbelopp, sparaPrisbasbelopp } from './skattetal';

let raknare = 0;

describe('egna prisbasbelopp', () => {
  it('remembers each year that is added', async () => {
    const db = new KonteraDatabase(`kontera-skattetal-${(raknare += 1)}`);
    await db.open();

    await sparaPrisbasbelopp(db, 2027, oreFromKronor('59600'));
    await sparaPrisbasbelopp(db, 2028, oreFromKronor('60400'));

    expect([...(await lasEgnaPrisbasbelopp(db))]).toEqual([
      [2027, oreFromKronor('59600')],
      [2028, oreFromKronor('60400')],
    ]);
  });

  it('refuses a figure that cannot be a prisbasbelopp', async () => {
    const db = new KonteraDatabase(`kontera-skattetal-${(raknare += 1)}`);
    await db.open();

    await expect(sparaPrisbasbelopp(db, 2027, oreFromKronor('59650'))).rejects.toThrow(
      'hundratal',
    );
    expect((await lasEgnaPrisbasbelopp(db)).size).toBe(0);
  });
});
