import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { oreFromKronor, ZERO } from '../domain/belopp/ore';
import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import { skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import {
  avyttraFastighetstillgang,
  bokforFastighetsavskrivning,
  fastighetsavskrivningsforslag,
  registreraFastighetstillgang,
} from './fastighet';
import { lasTillstand, skyddaBokfordaVerifikat } from './bokforing';
import { KonteraDatabase } from './db';
import { skrivKonto, skrivRakenskapsar, type Skrivkontext } from './kommandon';

let raknare = 0;
let klockslag = 1_788_554_000_000;

const nyDb = async () => {
  const db = new KonteraDatabase(`kontera-fastighet-${(raknare += 1)}`);
  skyddaBokfordaVerifikat(db);
  await db.open();
  return db;
};

const kontext: Skrivkontext = {
  enhet: 'enhet-a',
  nu: () => '2026-09-08T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(9)),
};

const AR_2026 = '019b76da-a800-7000-8000-000000002026' as Uuid;

async function skrivKonton(db: KonteraDatabase): Promise<void> {
  await skrivKonto(db, kontext, skapaKonto({ nummer: '1120', namn: 'Byggnader' }));
  await skrivKonto(
    db,
    kontext,
    skapaKonto({ nummer: '1129', namn: 'Ack avskr på byggnader' }),
  );
  await skrivKonto(
    db,
    kontext,
    skapaKonto({ nummer: '7820', namn: 'Avskrivningar på byggnader' }),
  );
}

async function nyttAr(db: KonteraDatabase) {
  await skrivRakenskapsar(
    db,
    kontext,
    skapaRakenskapsar({
      id: AR_2026,
      start: datum('2026-01-01'),
      slut: datum('2026-12-31'),
      ingaendeBalanser: [],
    }),
  );
}

describe('registreraFastighetstillgang och avyttraFastighetstillgang', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = await nyDb();
  });

  it('registers a byggnad and later marks it avyttrad', async () => {
    const tillgang = await registreraFastighetstillgang(db, kontext, {
      benamning: 'B2 ekonomibyggnad',
      anskaffningsdatum: datum('2012-06-01'),
      anskaffningsvarde: oreFromKronor('64518.50'),
      kategori: { typ: 'byggnad', byggnadstyp: 'ekonomibyggnad_ovrig' },
    });

    expect(
      (await lasTillstand(db)).fastigheter.get(tillgang.id)?.avyttring,
    ).toBeUndefined();

    await avyttraFastighetstillgang(db, kontext, tillgang.id, {
      datum: datum('2026-06-01'),
      typ: 'forsaljning',
      forsaljningsinkomst: oreFromKronor('20000'),
    });

    expect(
      (await lasTillstand(db)).fastigheter.get(tillgang.id)?.avyttring
        ?.forsaljningsinkomst,
    ).toBe(oreFromKronor('20000'));
  });
});

describe('fastighetsavskrivningsforslag och bokforFastighetsavskrivning', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = await nyDb();
    await skrivKonton(db);
    await nyttAr(db);
  });

  it('föreslår årets avskrivning individuellt per tillgång, utan pool', async () => {
    const byggnad = await registreraFastighetstillgang(db, kontext, {
      benamning: 'B2 ekonomibyggnad',
      anskaffningsdatum: datum('2012-06-01'),
      anskaffningsvarde: oreFromKronor('64518.50'),
      kategori: { typ: 'byggnad', byggnadstyp: 'ekonomibyggnad_ovrig' },
    });
    const mark = await registreraFastighetstillgang(db, kontext, {
      benamning: 'Åkermark',
      anskaffningsdatum: datum('2012-06-01'),
      anskaffningsvarde: oreFromKronor('18400'),
      kategori: { typ: 'mark' },
    });

    const forslag = await fastighetsavskrivningsforslag(db);
    const byggnadForslag = forslag.find((f) => f.tillgang.id === byggnad.id)!;
    const markForslag = forslag.find((f) => f.tillgang.id === mark.id)!;

    expect(byggnadForslag.forslag).toBe(oreFromKronor('2580.74'));
    expect(markForslag.forslag).toBe(ZERO);
  });

  it('bokför avskrivningen och uppdaterar registrets ackumulerade belopp för nästa år', async () => {
    const byggnad = await registreraFastighetstillgang(db, kontext, {
      benamning: 'B2 ekonomibyggnad',
      anskaffningsdatum: datum('2012-06-01'),
      anskaffningsvarde: oreFromKronor('64518.50'),
      kategori: { typ: 'byggnad', byggnadstyp: 'ekonomibyggnad_ovrig' },
    });

    const verifikat = await bokforFastighetsavskrivning(
      db,
      kontext,
      datum('2026-12-31'),
      verifikatserie('A'),
      byggnad.id,
      oreFromKronor('2580.74'),
      kontonummer('7820'),
      kontonummer('1129'),
    );

    expect(verifikat.konteringar).toEqual([
      { konto: kontonummer('7820'), belopp: oreFromKronor('2580.74') },
      { konto: kontonummer('1129'), belopp: oreFromKronor('-2580.74') },
    ]);

    const uppdaterad = (await lasTillstand(db)).fastigheter.get(byggnad.id)!;
    expect(uppdaterad.ackumuleradAvskrivning).toBe(oreFromKronor('2580.74'));

    const nastaForslag = (await fastighetsavskrivningsforslag(db)).find(
      (f) => f.tillgang.id === byggnad.id,
    )!;
    expect(nastaForslag.forslag).toBe(oreFromKronor('2580.74'));
    expect(nastaForslag.bokfortVardeInnan).toBe(oreFromKronor('61937.76'));
  });
});
