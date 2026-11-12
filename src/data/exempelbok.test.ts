import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { datum } from '../domain/tid/datum';
import { fastKlocka } from '../domain/tid/klocka';
import { isZero, sum } from '../domain/belopp/ore';
import { lasBokprofil } from './bokidentitet';
import { lasTillstand } from './bokforing';
import { Bokregister } from './bokregister';
import { BokfinkDatabase } from './db';
import { EXEMPEL_NYCKEL, EXEMPELBOKENS_NAMN, skapaExempelbok } from './exempelbok';

let raknare = 0;
const nyttRegister = () => new Bokregister(`kontera-exempel-register-${(raknare += 1)}`);
const kontext = {
  nu: () => '2026-11-12T08:00:00.000Z',
  nyttId: () => `exempel-${(raknare += 1)}`,
};

async function lasBok(databas: string) {
  const db = new BokfinkDatabase(databas);
  await db.open();
  return db;
}

describe('skapaExempelbok', () => {
  it('makes a firm book with a year of bookings, all balanced and none in the future', async () => {
    const idag = datum('2026-11-12');
    const bok = await skapaExempelbok(nyttRegister(), kontext, fastKlocka(idag));
    expect(bok.namn).toBe(EXEMPELBOKENS_NAMN);

    const db = await lasBok(bok.databas);
    expect(await lasBokprofil(db)).toBe('enskild_firma');
    expect(await db.getMeta(EXEMPEL_NYCKEL)).toBe(true);

    const verifikat = [...(await lasTillstand(db)).verifikat.values()];
    expect(verifikat).toHaveLength(14);
    for (const post of verifikat) {
      expect(isZero(sum(post.konteringar.map((rad) => rad.belopp)))).toBe(true);
      expect(post.datum <= idag).toBe(true);
      expect(post.datum >= datum('2026-01-01')).toBe(true);
    }
    // One continuous series from A1.
    expect(verifikat.map((post) => post.nummer).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 14 }, (_, i) => i + 1),
    );
    db.close();
  });

  it('books a sale with output moms and a purchase with input moms', async () => {
    const bok = await skapaExempelbok(
      nyttRegister(),
      kontext,
      fastKlocka(datum('2026-11-12')),
    );
    const db = await lasBok(bok.databas);
    const verifikat = [...(await lasTillstand(db)).verifikat.values()];

    const altan = verifikat.find((post) => post.beskrivning.startsWith('Altanbygge'));
    const konton = altan?.konteringar.map((rad) => String(rad.konto));
    expect(konton).toContain('2611');
    expect(konton).toContain('3000');

    const verktyg = verifikat.find((post) => post.beskrivning.startsWith('Kapsåg'));
    expect(verktyg?.konteringar.map((rad) => String(rad.konto))).toContain('2641');
    db.close();
  });

  it('works on the first of January, when the whole year is one day', async () => {
    const bok = await skapaExempelbok(
      nyttRegister(),
      kontext,
      fastKlocka(datum('2027-01-01')),
    );
    const db = await lasBok(bok.databas);
    const verifikat = [...(await lasTillstand(db)).verifikat.values()];
    expect(verifikat).toHaveLength(14);
    expect(new Set(verifikat.map((post) => post.datum))).toEqual(
      new Set([datum('2027-01-01')]),
    );
    db.close();
  });

  it('opens the example that is there rather than making a second one', async () => {
    const register = nyttRegister();
    const klocka = fastKlocka(datum('2026-11-12'));
    const forsta = await skapaExempelbok(register, kontext, klocka);
    const andra = await skapaExempelbok(register, kontext, klocka);
    expect(andra.id).toBe(forsta.id);
    // The original book and the example: no second example.
    expect(await register.bocker.count()).toBe(2);
  });
});
