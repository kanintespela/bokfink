import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import { skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast } from '../domain/verifikat/verifikat';
import { lasTillstand, skyddaBokfordaVerifikat } from './bokforing';
import { KonteraDatabase } from './db';
import {
  foreningsarsbokslut,
  lasRadval,
  lasStyrelse,
  sparaRadval,
  sparaStyrelse,
} from './foreningsbokslut';
import {
  bokforUtkast,
  skrivKonto,
  skrivRakenskapsar,
  type Skrivkontext,
} from './kommandon';

let raknare = 0;
let klockslag = 1_788_554_000_000;
const nyDb = async () => {
  const db = new KonteraDatabase(`kontera-foreningsbokslut-${(raknare += 1)}`);
  skyddaBokfordaVerifikat(db);
  await db.open();
  return db;
};
const kontext: Skrivkontext = {
  enhet: 'enhet-a',
  nu: () => '2027-01-20T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(5)),
};
const kr = oreFromKronor;

const AR_2025 = '019b76da-a800-7000-8000-000000002025' as Uuid;
const AR_2026 = '019b76da-a800-7000-8000-000000002026' as Uuid;

async function bokfor(db: KonteraDatabase, dag: string, rader: [string, string][]) {
  await bokforUtkast(
    db,
    kontext,
    skapaUtkast({
      id: kontext.nyttId!(),
      datum: datum(dag),
      beskrivning: 'x',
      konteringar: rader.map(([konto, belopp]) => ({
        konto: kontonummer(konto),
        belopp: kr(belopp),
      })),
    }),
    verifikatserie('A'),
  );
}

async function forening() {
  const db = await nyDb();
  for (const [nummer, namn] of [
    ['1930', 'Bank'],
    ['2010', 'Balanserat kapital'],
    ['3610', 'Medlemsavgifter'],
    ['5020', 'El'],
  ] as const) {
    await skrivKonto(db, kontext, skapaKonto({ nummer, namn }));
  }
  const ar2025 = skapaRakenskapsar({
    id: AR_2025,
    start: datum('2025-01-01'),
    slut: datum('2025-12-31'),
    ingaendeBalanser: [
      { konto: kontonummer('1930'), belopp: kr('50000') },
      { konto: kontonummer('2010'), belopp: kr('-50000') },
    ],
  });
  const ar2026 = skapaRakenskapsar({
    id: AR_2026,
    start: datum('2026-01-01'),
    slut: datum('2026-12-31'),
    ingaendeBalanser: [
      { konto: kontonummer('1930'), belopp: kr('60000') },
      { konto: kontonummer('2010'), belopp: kr('-60000') },
    ],
  });
  await skrivRakenskapsar(db, kontext, ar2025);
  await skrivRakenskapsar(db, kontext, ar2026);
  // 2025: 14 000 in fees, 4 000 for electricity: 10 000 surplus, 60 000 carried on.
  await bokfor(db, '2025-03-01', [
    ['1930', '14000'],
    ['3610', '-14000'],
  ]);
  await bokfor(db, '2025-06-01', [
    ['5020', '4000'],
    ['1930', '-4000'],
  ]);
  // 2026: 20 000 in fees, 5 000 for electricity: 15 000 surplus.
  await bokfor(db, '2026-03-01', [
    ['1930', '20000'],
    ['3610', '-20000'],
  ]);
  await bokfor(db, '2026-06-01', [
    ['5020', '5000'],
    ['1930', '-5000'],
  ]);
  return { db, ar2025, ar2026 };
}

describe('foreningsarsbokslut', () => {
  it('sets the year out with the year before as its comparative', async () => {
    const { db, ar2026 } = await forening();
    const bokslut = await foreningsarsbokslut(db, ar2026);

    expect(bokslut.aret.aretsResultat).toBe(kr('15000'));
    expect(bokslut.aret.summaTillgangar).toBe(kr('75000'));
    expect(bokslut.aret.balanseratResultat).toBe(kr('60000'));

    expect(bokslut.foregaendeAr?.id).toBe(AR_2025);
    expect(bokslut.foregaende?.aretsResultat).toBe(kr('10000'));
    expect(bokslut.foregaende?.summaTillgangar).toBe(kr('60000'));
    expect(bokslut.foregaende?.balanseratResultat).toBe(kr('50000'));
  });

  it('gives no comparatives for a first year, rather than made-up ones', async () => {
    const { db, ar2025 } = await forening();
    const bokslut = await foreningsarsbokslut(db, ar2025);
    expect(bokslut.foregaendeAr).toBeUndefined();
    expect(bokslut.foregaende).toBeUndefined();
    expect(bokslut.foregaendeKapital).toBeUndefined();
  });

  it("follows the association's placement of an account, in both years", async () => {
    const { db, ar2026 } = await forening();
    await sparaRadval(db, kontonummer('5020'), 'verksamhetskostnader');
    const bokslut = await foreningsarsbokslut(db, ar2026);
    expect(bokslut.aret.rader.get('verksamhetskostnader')?.belopp).toBe(kr('-5000'));
    expect(bokslut.foregaende?.rader.get('verksamhetskostnader')?.belopp).toBe(
      kr('-4000'),
    );
    expect(bokslut.aret.rader.has('ovriga_externa_kostnader')).toBe(false);
  });

  it("is unaffected by the year's result having been moved onto eget kapital", async () => {
    const { db, ar2026 } = await forening();
    await skrivKonto(db, kontext, skapaKonto({ nummer: '2019', namn: 'Årets resultat' }));
    await skrivKonto(
      db,
      kontext,
      skapaKonto({ nummer: '8999', namn: 'Årets resultat', typ: 'kostnad' }),
    );
    const fore = await foreningsarsbokslut(db, ar2026);
    await bokfor(db, '2026-12-31', [
      ['8999', '15000'],
      ['2019', '-15000'],
    ]);
    const efter = await foreningsarsbokslut(db, ar2026);
    expect(efter.aret.aretsResultat).toBe(fore.aret.aretsResultat);
    expect(efter.aret.balanseratResultat).toBe(fore.aret.balanseratResultat);
    expect(fore.ejOverfortResultat).toBe(kr('15000'));
    expect(efter.ejOverfortResultat).toBe(kr('0'));
    expect((await lasTillstand(db)).verifikat.size).toBe(5);
  });
});

describe('placement and signing', () => {
  it('remembers a placement and forgets it again', async () => {
    const db = await nyDb();
    await sparaRadval(db, kontonummer('5020'), 'verksamhetskostnader');
    expect((await lasRadval(db)).get(kontonummer('5020'))).toBe('verksamhetskostnader');
    await sparaRadval(db, kontonummer('5020'), undefined);
    expect((await lasRadval(db)).size).toBe(0);
  });

  it('refuses a placement the form does not allow', async () => {
    const db = await nyDb();
    await expect(sparaRadval(db, kontonummer('5020'), 'kassa_och_bank')).rejects.toThrow(
      'kan inte placeras',
    );
    await expect(sparaRadval(db, kontonummer('2010'), 'ovriga_skulder')).rejects.toThrow(
      'kan inte placeras',
    );
  });

  it('leaves out a stored placement that is no longer valid', async () => {
    const db = await nyDb();
    await db.setMeta('bokslut.foreningsradval', { '5020': 'kassa_och_bank', x: 'skatt' });
    expect((await lasRadval(db)).size).toBe(0);
  });

  it('keeps the board, trimmed and without empty lines', async () => {
    const db = await nyDb();
    await sparaStyrelse(db, [
      { namn: '  Exempel Ordförande ', roll: 'ordförande' },
      { namn: '   ', roll: 'ledamot' },
      { namn: 'Exempel Kassör', roll: ' kassör' },
    ]);
    expect(await lasStyrelse(db)).toEqual([
      { namn: 'Exempel Ordförande', roll: 'ordförande' },
      { namn: 'Exempel Kassör', roll: 'kassör' },
    ]);
  });
});
