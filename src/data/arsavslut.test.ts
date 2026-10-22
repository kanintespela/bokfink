import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import {
  skapaRakenskapsar,
  type Ingaendebalans,
  type Rakenskapsar,
} from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast } from '../domain/verifikat/verifikat';
import {
  arsavslutschecklista,
  forUtgaendeBalanserTillNastaAr,
  skapaNastaRakenskapsar,
} from './arsavslut';
import { lasTillstand, skyddaBokfordaVerifikat } from './bokforing';
import { KonteraDatabase } from './db';
import {
  avslutaRakenskapsar,
  bokforUtkast,
  skrivKonto,
  skrivRakenskapsar,
  type Skrivkontext,
} from './kommandon';

let raknare = 0;
let klockslag = 1_788_554_000_000;

const nyDb = async () => {
  const db = new KonteraDatabase(`kontera-arsavslut-${(raknare += 1)}`);
  skyddaBokfordaVerifikat(db);
  await db.open();
  return db;
};

const kontext: Skrivkontext = {
  enhet: 'enhet-a',
  nu: () => '2026-09-08T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(9)),
};

const AR_2026: Uuid = '019b76da-a800-7000-8000-000000002026' as Uuid;

async function nyttAr(
  db: KonteraDatabase,
  ingaendeBalanser: readonly Ingaendebalans[] = [],
): Promise<Rakenskapsar> {
  const ar = skapaRakenskapsar({
    id: AR_2026,
    start: datum('2026-01-01'),
    slut: datum('2026-12-31'),
    ingaendeBalanser,
  });
  await skrivRakenskapsar(db, kontext, ar);
  return ar;
}

describe('skapaNastaRakenskapsar', () => {
  it('skapar ett nytt kalenderår direkt efter det föregående', async () => {
    const db = await nyDb();
    const ar = await nyttAr(db);

    const nasta = await skapaNastaRakenskapsar(db, kontext, ar);
    expect(nasta.start).toBe(datum('2027-01-01'));
    expect(nasta.slut).toBe(datum('2027-12-31'));
  });

  /*
   * Två enheter som var för sig skapar nästa år måste hamna i ett år, inte
   * två - samma skäl som för året appen skapar vid första start.
   */
  it('ger nästa år samma identitet på varje enhet', async () => {
    const telefonen = await nyDb();
    const datorn = await nyDb();

    const pa = await skapaNastaRakenskapsar(telefonen, kontext, await nyttAr(telefonen));
    const pb = await skapaNastaRakenskapsar(datorn, kontext, await nyttAr(datorn));
    expect(pa.id).toBe(pb.id);
  });

  it('skapar inte ett andra år om ett för perioden redan finns', async () => {
    const db = await nyDb();
    const ar = await nyttAr(db);

    const forsta = await skapaNastaRakenskapsar(db, kontext, ar);
    const andra = await skapaNastaRakenskapsar(db, kontext, ar);
    expect(andra.id).toBe(forsta.id);

    const tillstand = await lasTillstand(db);
    // Det egna året plus det nyskapade - inget dubblerat.
    expect(tillstand.rakenskapsar.size).toBe(2);
  });
});

describe('arsavslutschecklista', () => {
  let db: KonteraDatabase;
  let ar: Rakenskapsar;

  beforeEach(async () => {
    db = await nyDb();
    ar = await nyttAr(db);
  });

  it('flaggar att momsen inte täcker hela året och att nästa år saknas', async () => {
    const checklista = await arsavslutschecklista(db, ar, datum('2026-12-31'));
    expect(checklista.momsTackerHelaAret).toBe(false);
    expect(checklista.nastaAr).toBeUndefined();
    expect(checklista.djurlagerInventeratIAr).toBe(false);
  });

  it('ser att momsen täcker hela året och att nästa år finns, när de gör det', async () => {
    await skrivRakenskapsar(
      db,
      kontext,
      skapaRakenskapsar({ ...ar, momslastTom: datum('2026-12-31') }),
    );
    const helAret = { ...ar, momslastTom: datum('2026-12-31') };
    await skapaNastaRakenskapsar(db, kontext, helAret);

    const checklista = await arsavslutschecklista(db, helAret, datum('2026-12-31'));
    expect(checklista.momsTackerHelaAret).toBe(true);
    expect(checklista.nastaAr?.start).toBe(datum('2027-01-01'));
  });
});

describe('forUtgaendeBalanserTillNastaAr', () => {
  it('för över kontonas utgående saldo som nästa års ingående balanser', async () => {
    const db = await nyDb();
    await skrivKonto(db, kontext, skapaKonto({ nummer: '1930', namn: 'Företagskontot' }));
    await skrivKonto(db, kontext, skapaKonto({ nummer: '2013', namn: 'Eget uttag' }));
    await skrivKonto(db, kontext, skapaKonto({ nummer: '2010', namn: 'Eget kapital' }));
    const ar = await nyttAr(db, [
      { konto: kontonummer('1930'), belopp: oreFromKronor('10000') },
      { konto: kontonummer('2010'), belopp: oreFromKronor('-10000') },
    ]);

    await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: kontext.nyttId!(),
        datum: datum('2026-06-01'),
        beskrivning: 'Eget uttag',
        konteringar: [
          { konto: kontonummer('2013'), belopp: oreFromKronor('4000') },
          { konto: kontonummer('1930'), belopp: oreFromKronor('-4000') },
        ],
      }),
      verifikatserie('A'),
    );

    const nastaAr = await skapaNastaRakenskapsar(db, kontext, ar);
    const { balanser } = await forUtgaendeBalanserTillNastaAr(
      db,
      kontext,
      ar,
      nastaAr.id,
      verifikatserie('A'),
    );

    expect(balanser).toEqual(
      expect.arrayContaining([
        { konto: kontonummer('1930'), belopp: oreFromKronor('6000') },
        { konto: kontonummer('2013'), belopp: oreFromKronor('4000') },
      ]),
    );

    const tillstand = await lasTillstand(db);
    expect(tillstand.rakenskapsar.get(nastaAr.id)?.ingaendeBalanser).toEqual(balanser);
  });

  it('lämnar bort konton vars utgående saldo är noll', async () => {
    const db = await nyDb();
    await skrivKonto(db, kontext, skapaKonto({ nummer: '1930', namn: 'Företagskontot' }));
    await skrivKonto(db, kontext, skapaKonto({ nummer: '2013', namn: 'Eget uttag' }));
    await skrivKonto(db, kontext, skapaKonto({ nummer: '2010', namn: 'Eget kapital' }));
    const ar = await nyttAr(db, [
      { konto: kontonummer('1930'), belopp: oreFromKronor('4000') },
      { konto: kontonummer('2010'), belopp: oreFromKronor('-4000') },
    ]);

    await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: kontext.nyttId!(),
        datum: datum('2026-06-01'),
        beskrivning: 'Eget uttag, saldot går till noll',
        konteringar: [
          { konto: kontonummer('2013'), belopp: oreFromKronor('4000') },
          { konto: kontonummer('1930'), belopp: oreFromKronor('-4000') },
        ],
      }),
      verifikatserie('A'),
    );

    const nastaAr = await skapaNastaRakenskapsar(db, kontext, ar);
    const { balanser } = await forUtgaendeBalanserTillNastaAr(
      db,
      kontext,
      ar,
      nastaAr.id,
      verifikatserie('A'),
    );

    expect(balanser.find((post) => post.konto === kontonummer('1930'))).toBeUndefined();
  });

  /*
   * Samma praxis som i andra bokföringsprogram (beslut 2026-09-13): uttag, insättningar
   * och skattekontot ska inte växa sig stora på sina egna konton - de förs
   * mot 2010 varje årsskifte, som ett vanligt bokfört verifikat daterat det
   * nya årets första dag.
   */
  it('bokför omföringen av 2011-2019 mot 2010 på det nya årets första dag', async () => {
    const db = await nyDb();
    for (const [nummer, namn] of [
      ['1930', 'Företagskontot'],
      ['2010', 'Eget kapital'],
      ['2013', 'Övriga egna uttag'],
      ['2017', 'Egna insättningar'],
    ] as const) {
      await skrivKonto(db, kontext, skapaKonto({ nummer, namn }));
    }
    const ar = await nyttAr(db, [
      { konto: kontonummer('1930'), belopp: oreFromKronor('50000') },
      { konto: kontonummer('2010'), belopp: oreFromKronor('-50000') },
    ]);

    await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: kontext.nyttId!(),
        datum: datum('2026-06-01'),
        beskrivning: 'Eget uttag',
        konteringar: [
          { konto: kontonummer('2013'), belopp: oreFromKronor('12000') },
          { konto: kontonummer('1930'), belopp: oreFromKronor('-12000') },
        ],
      }),
      verifikatserie('A'),
    );
    await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: kontext.nyttId!(),
        datum: datum('2026-08-01'),
        beskrivning: 'Egen insättning',
        konteringar: [
          { konto: kontonummer('1930'), belopp: oreFromKronor('2000') },
          { konto: kontonummer('2017'), belopp: oreFromKronor('-2000') },
        ],
      }),
      verifikatserie('A'),
    );

    const nastaAr = await skapaNastaRakenskapsar(db, kontext, ar);
    const { omforing } = await forUtgaendeBalanserTillNastaAr(
      db,
      kontext,
      ar,
      nastaAr.id,
      verifikatserie('A'),
    );

    expect(omforing?.datum).toBe(datum('2027-01-01'));
    expect(omforing?.konteringar.map((rad) => [rad.konto, rad.belopp])).toEqual(
      expect.arrayContaining([
        ['2013', oreFromKronor('-12000')],
        ['2017', oreFromKronor('2000')],
        ['2010', oreFromKronor('10000')],
      ]),
    );

    const tillstand = await lasTillstand(db);
    // Nästa års egna balanser är fortfarande de rena överförda talen -
    // omföringen är ett verifikat i nästa år, inte en ändring av dem.
    expect(tillstand.rakenskapsar.get(nastaAr.id)?.ingaendeBalanser).toEqual(
      expect.arrayContaining([
        { konto: kontonummer('2013'), belopp: oreFromKronor('12000') },
        { konto: kontonummer('2017'), belopp: oreFromKronor('-2000') },
      ]),
    );
  });

  it('bokför omföringen bara en gång även om knappen trycks två gånger', async () => {
    const db = await nyDb();
    for (const [nummer, namn] of [
      ['1930', 'Företagskontot'],
      ['2010', 'Eget kapital'],
      ['2013', 'Övriga egna uttag'],
    ] as const) {
      await skrivKonto(db, kontext, skapaKonto({ nummer, namn }));
    }
    const ar = await nyttAr(db, [
      { konto: kontonummer('1930'), belopp: oreFromKronor('20000') },
      { konto: kontonummer('2010'), belopp: oreFromKronor('-20000') },
    ]);
    await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: kontext.nyttId!(),
        datum: datum('2026-06-01'),
        beskrivning: 'Eget uttag',
        konteringar: [
          { konto: kontonummer('2013'), belopp: oreFromKronor('5000') },
          { konto: kontonummer('1930'), belopp: oreFromKronor('-5000') },
        ],
      }),
      verifikatserie('A'),
    );

    const nastaAr = await skapaNastaRakenskapsar(db, kontext, ar);
    const forsta = await forUtgaendeBalanserTillNastaAr(
      db,
      kontext,
      ar,
      nastaAr.id,
      verifikatserie('A'),
    );
    const andra = await forUtgaendeBalanserTillNastaAr(
      db,
      kontext,
      ar,
      nastaAr.id,
      verifikatserie('A'),
    );

    expect(forsta.omforing?.id).toBe(andra.omforing?.id);

    const tillstand = await lasTillstand(db);
    const omforingar = [...tillstand.verifikat.values()].filter(
      (v) => v.beskrivning === 'Omföring av eget kapital',
    );
    expect(omforingar).toHaveLength(1);
  });

  it('för bara över balanserna utan att skapa en omföring när inget underkonto har saldo', async () => {
    const db = await nyDb();
    await skrivKonto(db, kontext, skapaKonto({ nummer: '1930', namn: 'Företagskontot' }));
    await skrivKonto(db, kontext, skapaKonto({ nummer: '2010', namn: 'Eget kapital' }));
    const ar = await nyttAr(db, [
      { konto: kontonummer('1930'), belopp: oreFromKronor('7000') },
      { konto: kontonummer('2010'), belopp: oreFromKronor('-7000') },
    ]);

    const nastaAr = await skapaNastaRakenskapsar(db, kontext, ar);
    const { omforing } = await forUtgaendeBalanserTillNastaAr(
      db,
      kontext,
      ar,
      nastaAr.id,
      verifikatserie('A'),
    );

    expect(omforing).toBeUndefined();
  });
});

describe('avslutaRakenskapsar', () => {
  it('går att avsluta ett år efter att balanserna förts över', async () => {
    const db = await nyDb();
    const ar = await nyttAr(db);
    const nastaAr = await skapaNastaRakenskapsar(db, kontext, ar);
    await forUtgaendeBalanserTillNastaAr(
      db,
      kontext,
      ar,
      nastaAr.id,
      verifikatserie('A'),
    );
    await avslutaRakenskapsar(db, kontext, ar.id);

    const tillstand = await lasTillstand(db);
    expect(tillstand.rakenskapsar.get(ar.id)?.avslutat).toBe(true);
  });
});
