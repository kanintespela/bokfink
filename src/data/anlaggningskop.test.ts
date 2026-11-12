import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import { skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast } from '../domain/verifikat/verifikat';
import { registreraAnlaggningstillgang } from './anlaggning';
import {
  avfardaAnlaggningskop,
  lasOregistreradeAnlaggningskop,
  OkantVerifikatError,
} from './anlaggningskop';
import { lasTillstand, skyddaBokfordaVerifikat } from './bokforing';
import { BokfinkDatabase } from './db';
import { registreraFastighetstillgang } from './fastighet';
import {
  bokforUtkast,
  skrivKonto,
  skrivRakenskapsar,
  type Skrivkontext,
} from './kommandon';

let raknare = 0;
let klockslag = 1_788_554_000_000;

const kontext: Skrivkontext = {
  enhet: 'enhet-a',
  nu: () => '2026-11-12T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(4)),
};

const AR_2026 = { start: datum('2026-01-01'), slut: datum('2026-12-31') };

async function nyDb(): Promise<BokfinkDatabase> {
  const db = new BokfinkDatabase(`kontera-anlaggningskop-${(raknare += 1)}`);
  skyddaBokfordaVerifikat(db);
  await db.open();
  for (const ar of ['2025', '2026']) {
    await skrivRakenskapsar(
      db,
      kontext,
      skapaRakenskapsar({
        id: `019b76da-a800-7000-8000-00000000${ar}` as Uuid,
        start: datum(`${ar}-01-01`),
        slut: datum(`${ar}-12-31`),
      }),
    );
  }
  for (const [nummer, namn] of [
    ['1150', 'Markanläggningar'],
    ['1221', 'Årets nyanskaffning av maskiner och inventarier'],
    ['1930', 'Företagskonto'],
    ['2641', 'Debiterad ingående moms'],
  ] as const) {
    await skrivKonto(db, kontext, skapaKonto({ nummer, namn }));
  }
  return db;
}

async function bokforKop(
  db: BokfinkDatabase,
  konto: string,
  kronor: string,
  dag = '2026-11-10',
  beskrivning = 'Borrad brunn',
) {
  return bokforUtkast(
    db,
    kontext,
    skapaUtkast({
      id: kontext.nyttId!() as Uuid,
      datum: datum(dag),
      beskrivning,
      konteringar: [
        { konto: kontonummer(konto), belopp: oreFromKronor(kronor) },
        { konto: kontonummer('1930'), belopp: oreFromKronor(`-${kronor}`) },
      ],
    }),
    verifikatserie('A'),
  );
}

describe('lasOregistreradeAnlaggningskop', () => {
  let db: BokfinkDatabase;

  beforeEach(async () => {
    db = await nyDb();
  });

  it('offers a booked purchase until a register entry points at it', async () => {
    const brunn = await bokforKop(db, '1150', '75000');

    const fore = await lasOregistreradeAnlaggningskop(db, AR_2026);
    expect(fore.map((kop) => [kop.verifikat.id, kop.slag, kop.belopp])).toEqual([
      [brunn.id, 'markanlaggning', oreFromKronor('75000')],
    ]);

    await registreraFastighetstillgang(db, kontext, {
      benamning: 'Borrad brunn',
      anskaffningsdatum: brunn.datum,
      anskaffningsvarde: oreFromKronor('75000'),
      kategori: { typ: 'markanlaggning', markanlaggningstyp: 'ovrig' },
      verifikatId: brunn.id,
    });

    expect(await lasOregistreradeAnlaggningskop(db, AR_2026)).toEqual([]);
    const [post] = [...(await lasTillstand(db)).fastigheter.values()];
    expect(post?.verifikatId).toBe(brunn.id);
  });

  it('does the same for a machine in the inventory register', async () => {
    const traktor = await bokforKop(db, '1221', '50000', '2026-04-20', 'John Deere 2120');

    await registreraAnlaggningstillgang(db, kontext, {
      benamning: 'John Deere 2120',
      anskaffningsdatum: traktor.datum,
      anskaffningsvarde: oreFromKronor('50000'),
      nyttjandeperiod: 5,
      verifikatId: traktor.id,
    });

    expect(await lasOregistreradeAnlaggningskop(db, AR_2026)).toEqual([]);
    const [post] = [...(await lasTillstand(db)).anlaggningar.values()];
    expect(post?.verifikatId).toBe(traktor.id);
  });

  /*
   * Books imported with their history would otherwise arrive with a question
   * for every machine ever bought.
   */
  it('asks only about the period it is given', async () => {
    await bokforKop(db, '1221', '38100', '2025-01-01', 'Sågverk');
    const iAr = await bokforKop(db, '1221', '50000', '2026-04-20', 'Traktor');

    const kop = await lasOregistreradeAnlaggningskop(db, AR_2026);

    expect(kop.map((post) => post.verifikat.id)).toEqual([iAr.id]);
  });

  it('stops asking about a purchase that was not an asset', async () => {
    const kop = await bokforKop(db, '1221', '50000');

    await avfardaAnlaggningskop(db, kop.id);
    // Twice is the same as once.
    await avfardaAnlaggningskop(db, kop.id);

    expect(await lasOregistreradeAnlaggningskop(db, AR_2026)).toEqual([]);
  });

  it('lists the oldest purchase first', async () => {
    const sen = await bokforKop(db, '1150', '75000', '2026-11-10');
    const tidig = await bokforKop(db, '1221', '50000', '2026-04-20');

    const kop = await lasOregistreradeAnlaggningskop(db, AR_2026);

    expect(kop.map((post) => post.verifikat.id)).toEqual([tidig.id, sen.id]);
  });
});

describe('a register entry that points at a verifikat', () => {
  it('is refused when the books hold no such verifikat', async () => {
    const db = await nyDb();
    const okant = '019b76da-a800-7000-8000-00000000dead' as Uuid;

    await expect(
      registreraFastighetstillgang(db, kontext, {
        benamning: 'Borrad brunn',
        anskaffningsdatum: datum('2026-11-10'),
        anskaffningsvarde: oreFromKronor('75000'),
        kategori: { typ: 'markanlaggning', markanlaggningstyp: 'ovrig' },
        verifikatId: okant,
      }),
    ).rejects.toThrow(OkantVerifikatError);
    await expect(
      registreraAnlaggningstillgang(db, kontext, {
        benamning: 'Traktor',
        anskaffningsdatum: datum('2026-11-10'),
        anskaffningsvarde: oreFromKronor('50000'),
        nyttjandeperiod: 5,
        verifikatId: okant,
      }),
    ).rejects.toThrow(OkantVerifikatError);

    const tillstand = await lasTillstand(db);
    expect(tillstand.fastigheter.size + tillstand.anlaggningar.size).toBe(0);
  });
});
