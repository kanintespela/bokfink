import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import { omfattar, skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { beraknaForenkladArsbokslut } from '../domain/bokslut/forenkladArsbokslut';
import { beraknaSaldon } from '../domain/rapport/saldon';
import { skapaUtkast } from '../domain/verifikat/verifikat';
import {
  bokforEgetUttagInsattning,
  bokforResultatoverforing,
  egetkapitalsammanstallning,
} from './egetkapital';
import { lasTillstand, skyddaBokfordaVerifikat } from './bokforing';
import { KonteraDatabase } from './db';
import {
  annulleraVerifikat,
  bokforUtkast,
  nyttId,
  skrivKonto,
  skrivRakenskapsar,
  type Skrivkontext,
} from './kommandon';

let raknare = 0;
let klockslag = 1_788_554_000_000;

const nyDb = async () => {
  const db = new KonteraDatabase(`kontera-egetkapital-${(raknare += 1)}`);
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

describe('bokforEgetUttagInsattning och egetkapitalsammanstallning', () => {
  it('räknar uttag och insättningar var för sig, och in i utgående eget kapital', async () => {
    const db = await nyDb();
    await skrivKonto(db, kontext, skapaKonto({ nummer: '1930', namn: 'Företagskontot' }));
    await skrivKonto(
      db,
      kontext,
      skapaKonto({ nummer: '2013', namn: 'Eget uttag och egen insättning' }),
    );
    await skrivKonto(db, kontext, skapaKonto({ nummer: '2010', namn: 'Eget kapital' }));
    await skrivKonto(db, kontext, skapaKonto({ nummer: '3010', namn: 'Försäljning' }));

    const ar = skapaRakenskapsar({
      id: AR_2026,
      start: datum('2026-01-01'),
      slut: datum('2026-12-31'),
      ingaendeBalanser: [
        { konto: kontonummer('1930'), belopp: oreFromKronor('20000') },
        { konto: kontonummer('2010'), belopp: oreFromKronor('-20000') },
      ],
    });
    await skrivRakenskapsar(db, kontext, ar);

    await bokforEgetUttagInsattning(
      db,
      kontext,
      datum('2026-03-01'),
      verifikatserie('A'),
      'uttag',
      kontonummer('1930'),
      kontonummer('2013'),
      oreFromKronor('6000'),
    );
    await bokforEgetUttagInsattning(
      db,
      kontext,
      datum('2026-06-01'),
      verifikatserie('A'),
      'insattning',
      kontonummer('1930'),
      kontonummer('2013'),
      oreFromKronor('2500'),
    );

    const sammanstallning = await egetkapitalsammanstallning(db, ar, [
      kontonummer('2013'),
    ]);

    // Eget kapital har eget tecken här: 20 000 i firman, inte kredit -20 000.
    expect(sammanstallning.ibEgetKapital).toBe(oreFromKronor('20000'));
    expect(sammanstallning.uttagIAr).toBe(oreFromKronor('6000'));
    expect(sammanstallning.insattningarIAr).toBe(oreFromKronor('2500'));
    expect(sammanstallning.aretsResultat).toBe(oreFromKronor('0'));
    // 20 000 - 6 000 + 2 500 + 0 = 16 500
    expect(sammanstallning.ubEgetKapital).toBe(oreFromKronor('16500'));
  });

  it('räknar uttag på 2013 och insättningar på 2017 som BAS K1 delar dem', async () => {
    const db = await nyDb();
    await skrivKonto(db, kontext, skapaKonto({ nummer: '1930', namn: 'Företagskontot' }));
    await skrivKonto(
      db,
      kontext,
      skapaKonto({ nummer: '2013', namn: 'Övriga egna uttag' }),
    );
    await skrivKonto(
      db,
      kontext,
      skapaKonto({ nummer: '2017', namn: 'Egna insättningar' }),
    );
    const ar = skapaRakenskapsar({
      id: AR_2026,
      start: datum('2026-01-01'),
      slut: datum('2026-12-31'),
      ingaendeBalanser: [],
    });
    await skrivRakenskapsar(db, kontext, ar);

    await bokforEgetUttagInsattning(
      db,
      kontext,
      datum('2026-03-01'),
      verifikatserie('A'),
      'uttag',
      kontonummer('1930'),
      kontonummer('2013'),
      oreFromKronor('6000'),
    );
    await bokforEgetUttagInsattning(
      db,
      kontext,
      datum('2026-06-01'),
      verifikatserie('A'),
      'insattning',
      kontonummer('1930'),
      kontonummer('2017'),
      oreFromKronor('2500'),
    );

    const sammanstallning = await egetkapitalsammanstallning(db, ar, [
      kontonummer('2013'),
      kontonummer('2017'),
    ]);
    expect(sammanstallning.uttagIAr).toBe(oreFromKronor('6000'));
    expect(sammanstallning.insattningarIAr).toBe(oreFromKronor('2500'));
  });

  it('bokför uttag med uttagskontot på debet, betalkontot på kredit', async () => {
    const db = await nyDb();
    await skrivKonto(db, kontext, skapaKonto({ nummer: '1930', namn: 'Företagskontot' }));
    await skrivKonto(
      db,
      kontext,
      skapaKonto({ nummer: '2013', namn: 'Eget uttag och egen insättning' }),
    );
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

    const verifikat = await bokforEgetUttagInsattning(
      db,
      kontext,
      datum('2026-03-01'),
      verifikatserie('A'),
      'uttag',
      kontonummer('1930'),
      kontonummer('2013'),
      oreFromKronor('6000'),
    );

    expect(verifikat.konteringar).toEqual([
      { konto: kontonummer('2013'), belopp: oreFromKronor('6000') },
      { konto: kontonummer('1930'), belopp: oreFromKronor('-6000') },
    ]);
  });
});

/**
 * A year closed the way many programs' SIE files close one: the result is moved
 * off the result accounts with an 8999/2019 entry. The sammanställningen has
 * to read the same before and after that entry, and has to agree with B10 in
 * det förenklade årsbokslutet, which is the figure the same eget kapital is
 * reported under.
 */
describe('egetkapitalsammanstallning för ett år med resultatöverföring', () => {
  const uppsattning = async () => {
    const db = await nyDb();
    for (const [nummer, namn] of [
      ['1930', 'Företagskontot'],
      ['2010', 'Eget kapital'],
      ['2013', 'Eget uttag och egen insättning'],
      ['2019', 'Årets resultat'],
      ['3010', 'Försäljning'],
    ] as const) {
      await skrivKonto(db, kontext, skapaKonto({ nummer, namn }));
    }
    await skrivKonto(
      db,
      kontext,
      // Klass 8 går inte att härleda ur numret, så typen anges uttryckligen.
      skapaKonto({ nummer: '8999', namn: 'Årets resultat', typ: 'kostnad' }),
    );

    const ar = skapaRakenskapsar({
      id: AR_2026,
      start: datum('2026-01-01'),
      slut: datum('2026-12-31'),
      ingaendeBalanser: [
        { konto: kontonummer('1930'), belopp: oreFromKronor('50000') },
        { konto: kontonummer('2010'), belopp: oreFromKronor('-50000') },
      ],
    });
    await skrivRakenskapsar(db, kontext, ar);

    // Försäljning 100 000, uttag 30 000.
    await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: nyttId(kontext),
        datum: datum('2026-04-01'),
        beskrivning: 'Försäljning',
        konteringar: [
          { konto: kontonummer('1930'), belopp: oreFromKronor('100000') },
          { konto: kontonummer('3010'), belopp: oreFromKronor('-100000') },
        ],
      }),
      verifikatserie('A'),
    );
    await bokforEgetUttagInsattning(
      db,
      kontext,
      datum('2026-05-01'),
      verifikatserie('A'),
      'uttag',
      kontonummer('1930'),
      kontonummer('2013'),
      oreFromKronor('30000'),
    );

    return { db, ar };
  };

  const bokslut = async (
    db: KonteraDatabase,
    ar: Awaited<ReturnType<typeof uppsattning>>['ar'],
  ) => {
    const tillstand = await lasTillstand(db);
    const iAret = [...tillstand.verifikat.values()].filter((v) => omfattar(ar, v.datum));
    return beraknaForenkladArsbokslut(beraknaSaldon(ar.ingaendeBalanser, iAret));
  };

  // 50 000 - 30 000 + 100 000 = 120 000
  const UB = oreFromKronor('120000');

  it('räknar med årets resultat medan det ligger kvar på resultatkontona', async () => {
    const { db, ar } = await uppsattning();

    const sammanstallning = await egetkapitalsammanstallning(db, ar, [
      kontonummer('2013'),
    ]);

    expect(sammanstallning.ibEgetKapital).toBe(oreFromKronor('50000'));
    expect(sammanstallning.uttagIAr).toBe(oreFromKronor('30000'));
    expect(sammanstallning.aretsResultat).toBe(oreFromKronor('100000'));
    expect(sammanstallning.ubEgetKapital).toBe(UB);
    expect((await bokslut(db, ar)).rutor.get('B10')?.belopp).toBe(UB);
  });

  it('räknar med årets resultat även när det förts över till 2019', async () => {
    const { db, ar } = await uppsattning();
    await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: nyttId(kontext),
        datum: datum('2026-12-31'),
        beskrivning: 'Årets resultat',
        konteringar: [
          { konto: kontonummer('8999'), belopp: oreFromKronor('100000') },
          { konto: kontonummer('2019'), belopp: oreFromKronor('-100000') },
        ],
      }),
      verifikatserie('A'),
    );

    const sammanstallning = await egetkapitalsammanstallning(db, ar, [
      kontonummer('2013'),
    ]);

    expect(sammanstallning.ibEgetKapital).toBe(oreFromKronor('50000'));
    expect(sammanstallning.uttagIAr).toBe(oreFromKronor('30000'));
    expect(sammanstallning.aretsResultat).toBe(oreFromKronor('100000'));
    expect(sammanstallning.ubEgetKapital).toBe(UB);
    expect((await bokslut(db, ar)).rutor.get('B10')?.belopp).toBe(UB);
  });
});

/*
 * Ett felaktigt verifikat och dess annullering tar ut varandra i böckerna,
 * men räknade man varje kontering för sig blev annulleringens debet på 2013
 * ett "uttag". I en helårskörning visade sammanställningen 25 000 kr i uttag
 * där bara 5 000 kr hade tagits ut.
 */
describe('egetkapitalsammanstallning med ett annullerat verifikat', () => {
  it('räknar varken originalet eller annulleringen som uttag eller insättning', async () => {
    const db = await nyDb();
    for (const [nummer, namn] of [
      ['1930', 'Företagskontot'],
      ['2013', 'Eget uttag och egen insättning'],
      ['4010', 'Inköp'],
    ] as const) {
      await skrivKonto(db, kontext, skapaKonto({ nummer, namn }));
    }
    const ar = skapaRakenskapsar({
      id: AR_2026,
      start: datum('2026-01-01'),
      slut: datum('2026-12-31'),
    });
    await skrivRakenskapsar(db, kontext, ar);

    const felaktigt = await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: nyttId(kontext),
        datum: datum('2026-09-05'),
        beskrivning: 'Foder, fel belopp',
        konteringar: [
          { konto: kontonummer('4010'), belopp: oreFromKronor('20000') },
          { konto: kontonummer('2013'), belopp: oreFromKronor('-20000') },
        ],
      }),
      verifikatserie('A'),
    );
    await annulleraVerifikat(db, kontext, felaktigt, datum('2026-09-05'));
    await bokforEgetUttagInsattning(
      db,
      kontext,
      datum('2026-10-01'),
      verifikatserie('A'),
      'uttag',
      kontonummer('1930'),
      kontonummer('2013'),
      oreFromKronor('5000'),
    );

    const summering = await egetkapitalsammanstallning(db, ar, [kontonummer('2013')]);
    expect(summering.uttagIAr).toBe(oreFromKronor('5000'));
    expect(summering.insattningarIAr).toBe(oreFromKronor('0'));
  });
});

describe('bokforResultatoverforing', () => {
  const medBok = async () => {
    const db = await nyDb();
    for (const [nummer, namn] of [
      ['1930', 'Företagskontot'],
      ['3000', 'Försäljning'],
      ['5400', 'Förbrukningsmaterial'],
      ['2019', 'Årets resultat, delägare 1'],
    ] as const) {
      await skrivKonto(db, kontext, skapaKonto({ nummer, namn }));
    }
    await skrivKonto(
      db,
      kontext,
      skapaKonto({ nummer: '8999', namn: 'Årets resultat', typ: 'kostnad' }),
    );
    const ar = skapaRakenskapsar({
      id: AR_2026,
      start: datum('2026-01-01'),
      slut: datum('2026-12-31'),
      ingaendeBalanser: [],
    });
    await skrivRakenskapsar(db, kontext, ar);
    // 10 000 kr i försäljning, 4 000 kr i kostnad - 6 000 kr i vinst.
    await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: nyttId(kontext),
        datum: datum('2026-05-01'),
        beskrivning: 'Sålt',
        konteringar: [
          { konto: kontonummer('1930'), belopp: oreFromKronor('10000') },
          { konto: kontonummer('3000'), belopp: oreFromKronor('-10000') },
        ],
      }),
      verifikatserie('A'),
    );
    await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: nyttId(kontext),
        datum: datum('2026-06-01'),
        beskrivning: 'Köpt',
        konteringar: [
          { konto: kontonummer('5400'), belopp: oreFromKronor('4000') },
          { konto: kontonummer('1930'), belopp: oreFromKronor('-4000') },
        ],
      }),
      verifikatserie('A'),
    );
    return { db, ar };
  };

  it('bokför 8999 mot 2019 på årets sista dag, med årets vinst', async () => {
    const { db, ar } = await medBok();

    const verifikat = await bokforResultatoverforing(
      db,
      kontext,
      ar,
      verifikatserie('A'),
    );

    expect(verifikat.datum).toBe('2026-12-31');
    expect(verifikat.konteringar).toEqual([
      { konto: '8999', belopp: oreFromKronor('6000') },
      { konto: '2019', belopp: oreFromKronor('-6000') },
    ]);
  });

  it('vägrar en andra överföring när hela resultatet redan är fört', async () => {
    const { db, ar } = await medBok();
    await bokforResultatoverforing(db, kontext, ar, verifikatserie('A'));

    await expect(
      bokforResultatoverforing(db, kontext, ar, verifikatserie('A')),
    ).rejects.toThrow('redan fört');
  });

  it('för bara över en sen rättelses del av resultatet', async () => {
    const { db, ar } = await medBok();
    await bokforResultatoverforing(db, kontext, ar, verifikatserie('A'));

    // En glömd intäkt på 1 000 kr, bokförd efter den första överföringen.
    await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: nyttId(kontext),
        datum: datum('2026-11-01'),
        beskrivning: 'Glömd försäljning',
        konteringar: [
          { konto: kontonummer('1930'), belopp: oreFromKronor('1000') },
          { konto: kontonummer('3000'), belopp: oreFromKronor('-1000') },
        ],
      }),
      verifikatserie('A'),
    );

    const andra = await bokforResultatoverforing(db, kontext, ar, verifikatserie('A'));
    expect(andra.konteringar).toEqual([
      { konto: '8999', belopp: oreFromKronor('1000') },
      { konto: '2019', belopp: oreFromKronor('-1000') },
    ]);
  });
});
