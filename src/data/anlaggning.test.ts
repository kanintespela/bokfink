import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import {
  skapaRakenskapsar,
  type Rakenskapsar,
} from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast } from '../domain/verifikat/verifikat';
import {
  avyttraAnlaggningstillgang,
  berakningAvArsAvskrivning,
  bokforAvskrivning,
  registreraAnlaggningstillgang,
} from './anlaggning';
import { lasTillstand, skyddaBokfordaVerifikat } from './bokforing';
import { KonteraDatabase } from './db';
import {
  bokforUtkast,
  skrivKonto,
  skrivRakenskapsar,
  type Skrivkontext,
} from './kommandon';

let raknare = 0;
let klockslag = 1_788_554_000_000;

const nyDb = async () => {
  const db = new KonteraDatabase(`kontera-anlaggning-${(raknare += 1)}`);
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
  await skrivKonto(db, kontext, skapaKonto({ nummer: '1220', namn: 'Inventarier' }));
  await skrivKonto(
    db,
    kontext,
    skapaKonto({ nummer: '1229', namn: 'Ack avskr på inventarier o verktyg' }),
  );
  await skrivKonto(
    db,
    kontext,
    skapaKonto({ nummer: '7830', namn: 'Avskrivningar på maskiner och inv' }),
  );
  await skrivKonto(db, kontext, skapaKonto({ nummer: '1930', namn: 'Företagskontot' }));
}

async function nyttAr(db: KonteraDatabase, ib: Rakenskapsar['ingaendeBalanser'] = []) {
  await skrivRakenskapsar(
    db,
    kontext,
    skapaRakenskapsar({
      id: AR_2026,
      start: datum('2026-01-01'),
      slut: datum('2026-12-31'),
      ingaendeBalanser: ib,
    }),
  );
}

async function kopInventarie(db: KonteraDatabase, kronor: string, datumtext: string) {
  await bokforUtkast(
    db,
    kontext,
    skapaUtkast({
      id: kontext.nyttId!(),
      datum: datum(datumtext),
      beskrivning: 'Inköp av inventarie',
      konteringar: [
        { konto: kontonummer('1220'), belopp: oreFromKronor(kronor) },
        { konto: kontonummer('1930'), belopp: oreFromKronor(`-${kronor}`) },
      ],
    }),
    verifikatserie('A'),
  );
}

describe('registreraAnlaggningstillgang och avyttraAnlaggningstillgang', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = await nyDb();
  });

  it('registers an asset and later marks it avyttrad', async () => {
    const tillgang = await registreraAnlaggningstillgang(db, kontext, {
      benamning: 'Betgrep',
      anskaffningsdatum: datum('2026-01-09'),
      anskaffningsvarde: oreFromKronor('50000'),
      nyttjandeperiod: 10,
    });

    expect(
      (await lasTillstand(db)).anlaggningar.get(tillgang.id)?.avyttring,
    ).toBeUndefined();

    await avyttraAnlaggningstillgang(db, kontext, tillgang.id, {
      datum: datum('2026-06-01'),
      typ: 'forsaljning',
      forsaljningsinkomst: oreFromKronor('37000'),
    });

    expect(
      (await lasTillstand(db)).anlaggningar.get(tillgang.id)?.avyttring
        ?.forsaljningsinkomst,
    ).toBe(oreFromKronor('37000'));
  });
});

describe('berakningAvArsAvskrivning', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = await nyDb();
    await skrivKonton(db);
  });

  /*
   * The avskrivning for a year is worked out after it has ended, often in a
   * new calendar year whose prisbasbelopp is not decided yet. The limit that
   * applies is the year's own: Skatteverket gives it per inkomstår ("29 600
   * kronor för inkomstår 2026").
   */
  it('uses the fiscal year’s prisbasbelopp, not the one for the day it is run', async () => {
    await nyttAr(db);
    await kopInventarie(db, '20000', '2026-02-01');

    const ar = (await lasTillstand(db)).rakenskapsar.get(AR_2026)!;
    const resultat = await berakningAvArsAvskrivning(db, ar, [kontonummer('1220')]);

    // 20 000 is under half of 2026's 59 200, so all of it may be written off.
    expect(resultat.forslag.helaUnderlaget).toBe(oreFromKronor('20000'));
  });

  it('reads inköp straight from the pool account, with no ingående balans', async () => {
    await nyttAr(db);
    await kopInventarie(db, '50000', '2026-02-01');

    const ar = (await lasTillstand(db)).rakenskapsar.get(AR_2026)!;
    const resultat = await berakningAvArsAvskrivning(db, ar, [kontonummer('1220')]);

    expect(resultat.ib).toBe(oreFromKronor('0'));
    expect(resultat.aretsInkop).toBe(oreFromKronor('50000'));
    expect(resultat.aretsAvyttrat).toBe(oreFromKronor('0'));
    expect(resultat.forslag.underlag).toBe(oreFromKronor('50000'));
    expect(resultat.forslag.huvudregeln).toBe(oreFromKronor('15000'));
  });

  /*
   * BFN K1 exempel 6-5, end to end: an opening balance of 175 000 plus a
   * 50 000 purchase gives an underlag of 225 000 and a huvudregeln
   * depreciation of 67 500 - the same figures the domain layer's own test
   * already proves, now proven through the ledger too.
   */
  it('exempel 6-5, read through the ledger', async () => {
    await nyttAr(db, [
      { konto: kontonummer('1220'), belopp: oreFromKronor('175000') },
      { konto: kontonummer('1930'), belopp: oreFromKronor('-175000') },
    ]);
    await kopInventarie(db, '50000', '2026-02-01');

    const ar = (await lasTillstand(db)).rakenskapsar.get(AR_2026)!;
    const resultat = await berakningAvArsAvskrivning(db, ar, [kontonummer('1220')]);

    expect(resultat.forslag.underlag).toBe(oreFromKronor('225000'));
    expect(resultat.forslag.huvudregeln).toBe(oreFromKronor('67500'));
  });

  it('sums more than one pool account, matching a chart that splits gross and ack avskrivning', async () => {
    await nyttAr(db, [
      { konto: kontonummer('1220'), belopp: oreFromKronor('64000') },
      { konto: kontonummer('1229'), belopp: oreFromKronor('-38400') },
      { konto: kontonummer('1930'), belopp: oreFromKronor('-25600') },
    ]);

    const ar = (await lasTillstand(db)).rakenskapsar.get(AR_2026)!;
    const resultat = await berakningAvArsAvskrivning(db, ar, [
      kontonummer('1220'),
      kontonummer('1229'),
    ]);

    expect(resultat.ib).toBe(oreFromKronor('25600'));
  });

  it('separates a sale from a purchase by the sign of the posting', async () => {
    await nyttAr(db, [
      { konto: kontonummer('1220'), belopp: oreFromKronor('175000') },
      { konto: kontonummer('1930'), belopp: oreFromKronor('-175000') },
    ]);
    await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: kontext.nyttId!(),
        datum: datum('2026-03-01'),
        beskrivning: 'Försäljning av inventarie',
        konteringar: [
          { konto: kontonummer('1930'), belopp: oreFromKronor('37000') },
          { konto: kontonummer('1220'), belopp: oreFromKronor('-37000') },
        ],
      }),
      verifikatserie('A'),
    );

    const ar = (await lasTillstand(db)).rakenskapsar.get(AR_2026)!;
    const resultat = await berakningAvArsAvskrivning(db, ar, [kontonummer('1220')]);

    expect(resultat.aretsAvyttrat).toBe(oreFromKronor('37000'));
    expect(resultat.forslag.underlag).toBe(oreFromKronor('138000')); // 175 000 − 37 000
  });
});

describe('bokforAvskrivning', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = await nyDb();
    await skrivKonton(db);
    await nyttAr(db);
  });

  it('books a balanced verifikat for the chosen amount', async () => {
    const verifikat = await bokforAvskrivning(
      db,
      kontext,
      datum('2026-12-31'),
      verifikatserie('A'),
      oreFromKronor('15000'),
      kontonummer('7830'),
      kontonummer('1229'),
    );

    expect(verifikat.konteringar).toEqual([
      { konto: kontonummer('7830'), belopp: oreFromKronor('15000') },
      { konto: kontonummer('1229'), belopp: oreFromKronor('-15000') },
    ]);
  });
});
