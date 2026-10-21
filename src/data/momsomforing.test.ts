import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { foreslaMomsomforing } from '../domain/bokslut/momsomforing';
import { uuidv7 } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import { skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { beraknaSaldon } from '../domain/rapport/saldon';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { lasTillstand, skyddaBokfordaVerifikat } from './bokforing';
import { KonteraDatabase } from './db';
import { skrivKonto, skrivRakenskapsar, type Skrivkontext } from './kommandon';
import { bokforMomsomforing } from './momsomforing';

let raknare = 0;
let klockslag = 1_788_554_000_000;

const nyDb = async () => {
  const db = new KonteraDatabase(`kontera-momsomforing-${(raknare += 1)}`);
  skyddaBokfordaVerifikat(db);
  await db.open();
  return db;
};

const kontext: Skrivkontext = {
  enhet: 'enhet-a',
  nu: () => '2026-09-12T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(9)),
};

const AR = uuidv7(1, new Uint8Array(10).fill(1));

async function forberedd() {
  const db = await nyDb();
  for (const [nummer, namn] of [
    ['1650', 'Momsfordran'],
    ['2650', 'Redovisningskonto för moms'],
    ['2010', 'Eget kapital'],
  ] as const) {
    await skrivKonto(db, kontext, skapaKonto({ nummer, namn }));
  }
  await skrivRakenskapsar(
    db,
    kontext,
    skapaRakenskapsar({
      id: AR,
      start: datum('2026-01-01'),
      slut: datum('2026-12-31'),
      // Momsfordran på skuldkontot, mot eget kapital: den balanserar året.
      ingaendeBalanser: [
        { konto: kontonummer('2650'), belopp: oreFromKronor('1875') },
        { konto: kontonummer('2010'), belopp: oreFromKronor('-1875') },
      ],
    }),
  );
  return db;
}

describe('bokforMomsomforing', () => {
  it('bokför omföringen på bokslutsdagen och tömmer 2650', async () => {
    const db = await forberedd();
    const ar = (await lasTillstand(db)).rakenskapsar.get(AR)!;
    const omforing = foreslaMomsomforing(beraknaSaldon(ar.ingaendeBalanser, []))!;

    const verifikat = await bokforMomsomforing(
      db,
      kontext,
      ar.slut,
      verifikatserie('A'),
      omforing,
    );

    expect(verifikat.datum).toBe(datum('2026-12-31'));
    expect(verifikat.beskrivning).toBe('Momsfordran flyttad från 2650 till 1650');
    expect(verifikat.konteringar).toEqual([
      { konto: kontonummer('1650'), belopp: oreFromKronor('1875') },
      { konto: kontonummer('2650'), belopp: oreFromKronor('-1875') },
    ]);

    // Efter bokföringen finns ingenting kvar att föreslå.
    const efter = beraknaSaldon(ar.ingaendeBalanser, [verifikat]);
    expect(efter.get(kontonummer('2650'))?.utgaende).toBe(0);
    expect(efter.get(kontonummer('1650'))?.utgaende).toBe(oreFromKronor('1875'));
    expect(foreslaMomsomforing(efter)).toBeUndefined();
  });
});
