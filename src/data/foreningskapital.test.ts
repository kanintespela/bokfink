import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import { skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast } from '../domain/verifikat/verifikat';
import { forUtgaendeBalanserTillNastaAr, skapaNastaRakenskapsar } from './arsavslut';
import { lasTillstand, skyddaBokfordaVerifikat } from './bokforing';
import { KonteraDatabase } from './db';
import {
  bokforReservering,
  foreningskapitalFor,
  lasReserveradeKonton,
} from './foreningskapital';
import {
  annulleraVerifikat,
  bokforUtkast,
  skrivKonto,
  skrivRakenskapsar,
} from './kommandon';
import type { Skrivkontext } from './kommandon';

let raknare = 0;
let klockslag = 1_788_554_000_000;

const nyDb = async () => {
  const db = new KonteraDatabase(`kontera-foreningskapital-${(raknare += 1)}`);
  skyddaBokfordaVerifikat(db);
  await db.open();
  return db;
};

const kontext: Skrivkontext = {
  enhet: 'enhet-a',
  nu: () => '2026-09-08T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(9)),
};

const A = verifikatserie('A');
const AR_2026 = '019b76da-a800-7000-8000-000000002026' as Uuid;

/** A year with 100 000 kr in the bank, all of it capital, and a fee booked. */
async function forening() {
  const db = await nyDb();
  await skrivKonto(db, kontext, skapaKonto({ nummer: '1930', namn: 'Bank' }));
  await skrivKonto(
    db,
    kontext,
    skapaKonto({ nummer: '2010', namn: 'Balanserat kapital' }),
  );
  await skrivKonto(db, kontext, skapaKonto({ nummer: '3610', namn: 'Medlemsavgifter' }));
  const ar = skapaRakenskapsar({
    id: AR_2026,
    start: datum('2026-01-01'),
    slut: datum('2026-12-31'),
    ingaendeBalanser: [
      { konto: kontonummer('1930'), belopp: oreFromKronor('100000') },
      { konto: kontonummer('2010'), belopp: oreFromKronor('-100000') },
    ],
  });
  await skrivRakenskapsar(db, kontext, ar);
  await bokforUtkast(
    db,
    kontext,
    skapaUtkast({
      id: kontext.nyttId!(),
      datum: datum('2026-02-01'),
      beskrivning: 'Medlemsavgifter',
      konteringar: [
        { konto: kontonummer('1930'), belopp: oreFromKronor('5000') },
        { konto: kontonummer('3610'), belopp: oreFromKronor('-5000') },
      ],
    }),
    A,
  );
  return { db, ar };
}

describe('bokforReservering', () => {
  it('flyttar kapital till ett nytt ändamål utan att röra resultatet', async () => {
    const { db, ar } = await forening();
    const verifikat = await bokforReservering(db, kontext, {
      datum: datum('2026-06-01'),
      serie: A,
      konto: kontonummer('2030'),
      namn: 'Underhåll av lokalen',
      belopp: oreFromKronor('20000'),
      riktning: 'reservera',
    });

    expect(verifikat.beskrivning).toBe('Reservering: Underhåll av lokalen');
    expect((await lasTillstand(db)).konton.get(kontonummer('2030'))?.namn).toBe(
      'Underhåll av lokalen',
    );
    expect(await lasReserveradeKonton(db)).toEqual(['2030']);

    const kapital = await foreningskapitalFor(db, ar);
    expect(kapital.aretsResultat).toBe(oreFromKronor('5000'));
    expect(kapital.utgaende).toBe(oreFromKronor('105000'));
    expect(kapital.summaReserverat).toBe(oreFromKronor('20000'));
    expect(kapital.fritt).toBe(oreFromKronor('85000'));
  });

  it('behåller namnet på ett konto som redan finns och listar det bara en gång', async () => {
    const { db } = await forening();
    await skrivKonto(db, kontext, skapaKonto({ nummer: '2030', namn: 'Fond för taket' }));
    for (const riktning of ['reservera', 'reservera', 'frigor'] as const) {
      await bokforReservering(db, kontext, {
        datum: datum('2026-06-01'),
        serie: A,
        konto: kontonummer('2030'),
        namn: 'Ett annat namn',
        belopp: oreFromKronor('1000'),
        riktning,
      });
    }
    expect((await lasTillstand(db)).konton.get(kontonummer('2030'))?.namn).toBe(
      'Fond för taket',
    );
    expect(await lasReserveradeKonton(db)).toEqual(['2030']);
  });

  it('skriver ingenting när kontot inte duger', async () => {
    const { db } = await forening();
    const fore = (await lasTillstand(db)).verifikat.size;
    await expect(
      bokforReservering(db, kontext, {
        datum: datum('2026-06-01'),
        serie: A,
        konto: kontonummer('1930'),
        namn: 'Bank',
        belopp: oreFromKronor('1'),
        riktning: 'reservera',
      }),
    ).rejects.toThrow(/kan inte ta reserverade medel/);
    expect((await lasTillstand(db)).verifikat.size).toBe(fore);
    expect(await lasReserveradeKonton(db)).toEqual([]);
  });

  it('tar bort en reservering helt när den annulleras', async () => {
    const { db, ar } = await forening();
    const verifikat = await bokforReservering(db, kontext, {
      datum: datum('2026-06-01'),
      serie: A,
      konto: kontonummer('2030'),
      namn: 'Underhåll',
      belopp: oreFromKronor('20000'),
      riktning: 'reservera',
    });
    await annulleraVerifikat(db, kontext, verifikat, datum('2026-06-02'));

    const kapital = await foreningskapitalFor(db, ar);
    expect(kapital.summaReserverat).toBe(oreFromKronor('0'));
    expect(kapital.utgaende).toBe(oreFromKronor('105000'));
  });
});

describe('årsskiftet', () => {
  it('lämnar reserverade medel på sitt konto i stället för att vika in dem i 2010', async () => {
    const { db, ar } = await forening();
    await skrivKonto(db, kontext, skapaKonto({ nummer: '2019', namn: 'Årets resultat' }));
    await bokforReservering(db, kontext, {
      datum: datum('2026-06-01'),
      serie: A,
      konto: kontonummer('2030'),
      namn: 'Underhåll av lokalen',
      belopp: oreFromKronor('20000'),
      riktning: 'reservera',
    });

    const nastaAr = await skapaNastaRakenskapsar(db, kontext, ar);
    await forUtgaendeBalanserTillNastaAr(db, kontext, ar, nastaAr.id, A);

    const tillstand = await lasTillstand(db);
    const omforing = [...tillstand.verifikat.values()].find(
      (post) => post.datum === datum('2027-01-01'),
    );
    expect(omforing?.konteringar.map((rad) => rad.konto) ?? []).not.toContain('2030');

    const nytt = tillstand.rakenskapsar.get(nastaAr.id);
    expect(nytt?.ingaendeBalanser).toEqual(
      expect.arrayContaining([
        { konto: kontonummer('2030'), belopp: oreFromKronor('-20000') },
      ]),
    );
    const kapital = await foreningskapitalFor(db, nytt!);
    expect(kapital.summaReserverat).toBe(oreFromKronor('20000'));
  });
});
