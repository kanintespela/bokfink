import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { kontonummer } from '../domain/konto/konto';
import { PeriodLastError, skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { granskaSerie, verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast } from '../domain/verifikat/verifikat';
import { kodaPC8 } from '../domain/sie/pc8';
import { lasTillstand, skyddaBokfordaVerifikat } from './bokforing';
import { KonteraDatabase } from './db';
import { bokforUtkast, skrivRakenskapsar, type Skrivkontext } from './kommandon';
import { exporteraSie } from './sieexport';
import { importeraSieFiler } from './sieimport';

let raknare = 0;
let ms = 1_788_000_000_000;

const AR_2026 = '019b76da-a800-7000-8000-000000002026' as Uuid;

const kontext: Skrivkontext = {
  enhet: 'import',
  nu: () => '2026-09-05T09:00:00.000Z',
  nyttId: () => uuidv7((ms += 1), new Uint8Array(10).fill(1)),
};

/**
 * A synthetic export shaped like a real one: the same header, the same
 * account classes, and the same awkward corners. The real files stay out of
 * the repository - they carry a personal identity number and a complete set
 * of private finances.
 */
function siefil(ar: number, options: { verifikat?: string[]; ib?: string[] } = {}) {
  const rader = [
    '#FLAGGA 0',
    '#PROGRAM "Exempelbok" "2026-09-04"',
    '#FORMAT PC8',
    `#GEN ${ar}0904 "test"`,
    '#SIETYP 4',
    '#VALUTA SEK',
    `#RAR 0 ${ar}0101 ${ar}1231`,
    `#RAR -1 ${ar - 1}0101 ${ar - 1}1231`,
    '#KONTO 1930 "Företagskonto"',
    '#KONTO 2013 "Eget uttag/insättningar"',
    '#KONTO 2640 "Ingående moms"',
    '#KONTO 4010 "Inköp material och varor"',
    '#KONTO 8310 "Ränteintäkter"',
    '#KTYP 1930 T',
    '#KTYP 4010 K',
    '#KTYP 8310 I',
    // 2013 and 2640 are class 2, which some programs never type.
    ...(options.ib ?? []),
    ...(options.verifikat ?? []),
  ];
  return kodaPC8(`${rader.join('\n')}\n`);
}

const köp = (serie: string, nr: number, ar: number, dag: string) => [
  `#VER "${serie}" ${nr} ${ar}${dag} "Inköp av kraftfoder" ${ar}${dag} ""`,
  '{',
  '#TRANS 2013 {} -520.31',
  '#TRANS 2640 {} 104.06',
  '#TRANS 4010 {} 416.25',
  '}',
];

describe('importeraSieFiler', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = new KonteraDatabase(`kontera-sieimport-${(raknare += 1)}`);
    skyddaBokfordaVerifikat(db);
    await db.open();
  });

  it('brings in years, accounts and verifikat', async () => {
    const res = await importeraSieFiler(db, kontext, [
      siefil(2026, {
        verifikat: [...köp('A', 1, 2026, '0109'), ...köp('A', 2, 2026, '0213')],
      }),
    ]);

    expect(res).toMatchObject({ rakenskapsar: 1, konton: 5, verifikat: 2 });
    const st = await lasTillstand(db);
    expect(st.konton.size).toBe(5);
    expect(st.verifikat.size).toBe(2);
  });

  it('derives the type of class 2 accounts the file never types', async () => {
    await importeraSieFiler(db, kontext, [siefil(2026)]);
    const st = await lasTillstand(db);
    expect(st.konton.get(kontonummer('2013'))?.typ).toBe('egetKapital');
    expect(st.konton.get(kontonummer('2640'))?.typ).toBe('skuld');
    // Class 8 cannot be derived, so the file's own #KTYP has to carry it.
    expect(st.konton.get(kontonummer('8310'))?.typ).toBe('intakt');
  });

  it('keeps the verification numbers the file gives', async () => {
    await importeraSieFiler(db, kontext, [
      siefil(2026, {
        verifikat: [...köp('A', 7, 2026, '0109'), ...köp('A', 8, 2026, '0213')],
      }),
    ]);
    const st = await lasTillstand(db);
    expect([...st.verifikat.values()].map((v) => v.nummer).sort()).toEqual([7, 8]);
  });

  it('keeps two series in one year apart, as 2023 has', async () => {
    await importeraSieFiler(db, kontext, [
      siefil(2023, {
        verifikat: [...köp('V', 1, 2023, '0117'), ...köp('A', 1, 2023, '0930')],
      }),
    ]);

    const st = await lasTillstand(db);
    const serier = [...st.verifikat.values()].map((v) => v.serie).sort();
    expect(serier).toEqual(['A', 'V']);
  });

  /*
   * Every file names its own year as #RAR 0 and the one before it as -1, so a
   * four-file import would otherwise create every year twice. Only #RAR 0 is
   * taken.
   */
  it('creates each year once across overlapping files', async () => {
    const res = await importeraSieFiler(db, kontext, [
      siefil(2025, { verifikat: köp('A', 1, 2025, '0506') }),
      siefil(2026, { verifikat: köp('A', 1, 2026, '0109') }),
    ]);

    expect(res.rakenskapsar).toBe(2);
    const st = await lasTillstand(db);
    expect([...st.rakenskapsar.values()].map((a) => a.start).sort()).toEqual([
      '2025-01-01',
      '2026-01-01',
    ]);
    // The same number in the same series, one year apart, is not a collision.
    expect(st.verifikat.size).toBe(2);
  });

  it('takes files in fiscal year order whatever order they are handed in', async () => {
    const res = await importeraSieFiler(db, kontext, [
      siefil(2026, { verifikat: köp('A', 1, 2026, '0109') }),
      siefil(2025, { verifikat: köp('A', 1, 2025, '0506') }),
    ]);
    expect(res.verifikat).toBe(2);
  });

  it('reads opening balances for the file its own year', async () => {
    await importeraSieFiler(db, kontext, [
      siefil(2026, {
        ib: ['#IB 0 1930 23817.45', '#IB 0 2013 -23817.45', '#IB -1 1930 3912.65'],
      }),
    ]);

    const ar = [...(await lasTillstand(db)).rakenskapsar.values()][0]!;
    expect(ar.ingaendeBalanser).toEqual([
      { konto: '1930', belopp: oreFromKronor('23817.45') },
      { konto: '2013', belopp: oreFromKronor('-23817.45') },
    ]);
  });

  it('is unchanged by importing the same files twice', async () => {
    const filer = [siefil(2026, { verifikat: köp('A', 1, 2026, '0109') })];
    const forsta = await importeraSieFiler(db, kontext, filer);
    const andra = await importeraSieFiler(db, kontext, filer);

    expect(forsta).toMatchObject({ verifikat: 1, redanImporterade: 0 });
    expect(andra).toMatchObject({
      rakenskapsar: 0,
      konton: 0,
      verifikat: 0,
      redanImporterade: 1,
    });
    expect((await lasTillstand(db)).verifikat.size).toBe(1);
  });

  it('closes the years asked for and leaves the rest open', async () => {
    const res = await importeraSieFiler(
      db,
      kontext,
      [
        siefil(2025, { verifikat: köp('A', 1, 2025, '0506') }),
        siefil(2026, { verifikat: köp('A', 1, 2026, '0109') }),
      ],
      { avslutaTomOchMed: datum('2025-12-31') },
    );

    expect(res.avslutadeAr).toBe(1);
    const st = await lasTillstand(db);
    const ar = [...st.rakenskapsar.values()].sort((a, b) => (a.start < b.start ? -1 : 1));
    expect(ar.map((a) => [a.start.slice(0, 4), a.avslutat])).toEqual([
      ['2025', true],
      ['2026', false],
    ]);
  });

  it('makes a closed year refuse new bookkeeping', async () => {
    await importeraSieFiler(
      db,
      kontext,
      [siefil(2025, { verifikat: köp('A', 1, 2025, '0506') })],
      {
        avslutaTomOchMed: datum('2025-12-31'),
      },
    );

    const utkast = skapaUtkast({
      id: kontext.nyttId!(),
      datum: datum('2025-06-01'),
      beskrivning: 'Efterhandsbokföring',
      konteringar: [
        { konto: kontonummer('4010'), belopp: oreFromKronor('100.00') },
        { konto: kontonummer('2013'), belopp: oreFromKronor('-100.00') },
      ],
    });

    await expect(bokforUtkast(db, kontext, utkast, verifikatserie('A'))).rejects.toThrow(
      PeriodLastError,
    );
  });

  it('leaves every imported series unbroken', async () => {
    const verifikat = [1, 2, 3, 4, 5].flatMap((n) => köp('A', n, 2026, '0109'));
    await importeraSieFiler(db, kontext, [siefil(2026, { verifikat })]);

    const nummer = [...(await lasTillstand(db)).verifikat.values()].map((v) => v.nummer);
    expect(granskaSerie(nummer).obruten).toBe(true);
  });

  it('marks what it imported as coming from a SIE file', async () => {
    await importeraSieFiler(db, kontext, [
      siefil(2026, { verifikat: köp('A', 1, 2026, '0109') }),
    ]);
    const verifikat = [...(await lasTillstand(db)).verifikat.values()][0]!;
    expect(verifikat.kalla).toBe('sie-import');
    expect(Object.isFrozen(verifikat)).toBe(true);
  });

  it('refuses a file with no #RAR 0', async () => {
    const utanAr = kodaPC8('#SIETYP 4\n#FORMAT PC8\n#RAR -1 20250101 20251231\n');
    await expect(importeraSieFiler(db, kontext, [utanAr])).rejects.toThrow(/#RAR 0/);
  });
});

describe('ingående balanser på ett år som redan finns', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = new KonteraDatabase(`kontera-sieib-${(raknare += 1)}`);
    skyddaBokfordaVerifikat(db);
    await db.open();
  });

  const medIb = (...rader: string[]) => siefil(2026, { ib: rader });

  /*
   * The app creates the current year at first start, empty. Importing into it
   * has to fill in what the file carries, or every account quietly starts at
   * zero and the whole ledger is out by the opening balance.
   */
  it('fills in the balances when the existing year has none', async () => {
    await skrivRakenskapsar(
      db,
      kontext,
      skapaRakenskapsar({
        id: AR_2026,
        start: datum('2026-01-01'),
        slut: datum('2026-12-31'),
      }),
    );

    const res = await importeraSieFiler(db, kontext, [
      medIb('#IB 0 1930 23817.45', '#IB 0 2013 -23817.45'),
    ]);

    expect(res.rakenskapsar).toBe(0);
    const ar = [...(await lasTillstand(db)).rakenskapsar.values()][0]!;
    expect(ar.ingaendeBalanser).toEqual([
      { konto: '1930', belopp: oreFromKronor('23817.45') },
      { konto: '2013', belopp: oreFromKronor('-23817.45') },
    ]);
  });

  it('leaves balances that are already there alone and says so', async () => {
    await importeraSieFiler(db, kontext, [
      medIb('#IB 0 1930 23817.45', '#IB 0 2013 -23817.45'),
    ]);

    const res = await importeraSieFiler(db, kontext, [
      medIb('#IB 0 1930 999.00', '#IB 0 2013 -999.00'),
    ]);

    expect(res.varningar[0]).toContain('skiljer sig');
    const ar = [...(await lasTillstand(db)).rakenskapsar.values()][0]!;
    expect(ar.ingaendeBalanser[0]?.belopp).toBe(oreFromKronor('23817.45'));
  });

  it('says nothing when the file agrees with what is already there', async () => {
    const fil = medIb('#IB 0 1930 23817.45', '#IB 0 2013 -23817.45');
    await importeraSieFiler(db, kontext, [fil]);
    const res = await importeraSieFiler(db, kontext, [fil]);
    expect(res.varningar).toEqual([]);
  });
});

describe('importeraSieFiler och projekt', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = new KonteraDatabase(`kontera-sieimport-projekt-${(raknare += 1)}`);
    skyddaBokfordaVerifikat(db);
    await db.open();
  });

  /** A booking of 520.31 for feed where the cost line names the given object list. */
  const medProjekt = (nr: number, ar: number, objektlista: string) => [
    `#VER "A" ${nr} ${ar}0109 "Inköp av kraftfoder" ${ar}0109 ""`,
    '{',
    '#TRANS 2013 {} -520.31',
    `#TRANS 4010 ${objektlista} 520.31`,
    '}',
  ];

  const DEKLARATION = ['#DIM 6 "Projekt"', '#OBJEKT 6 "P2026" "Ungdomsläger 2026"'];

  it('makes a project of each project object and puts it on the lines that name it', async () => {
    const resultat = await importeraSieFiler(db, kontext, [
      siefil(2026, {
        ib: DEKLARATION,
        verifikat: medProjekt(1, 2026, '{6 "P2026"}'),
      }),
    ]);

    expect(resultat.projekt).toBe(1);
    const tillstand = await lasTillstand(db);
    const [projekt] = [...tillstand.projekt.values()];
    expect(projekt).toMatchObject({
      kod: 'P2026',
      namn: 'Ungdomsläger 2026',
      avslutat: false,
    });

    const [verifikat] = [...tillstand.verifikat.values()];
    expect(verifikat?.konteringar.find((rad) => rad.konto === '4010')?.projekt).toBe(
      projekt?.id,
    );
    // The line with no object stays an ordinary line.
    expect(verifikat?.konteringar.find((rad) => rad.konto === '2013')).not.toHaveProperty(
      'projekt',
    );
  });

  it('makes a project of every declared object, used or not, since they are the list', async () => {
    await importeraSieFiler(db, kontext, [
      siefil(2026, {
        ib: [...DEKLARATION, '#OBJEKT 6 "OANVANT" "Aldrig bokat"'],
        verifikat: medProjekt(1, 2026, '{6 "P2026"}'),
      }),
    ]);
    expect(
      [...(await lasTillstand(db)).projekt.values()].map((p) => p.kod).sort(),
    ).toEqual(['OANVANT', 'P2026']);
  });

  it('reuses a project a second year names, instead of making another', async () => {
    const resultat = await importeraSieFiler(db, kontext, [
      siefil(2025, { ib: DEKLARATION, verifikat: medProjekt(1, 2025, '{6 "P2026"}') }),
      siefil(2026, { ib: DEKLARATION, verifikat: medProjekt(1, 2026, '{6 "P2026"}') }),
    ]);
    expect(resultat.projekt).toBe(1);
    expect((await lasTillstand(db)).projekt.size).toBe(1);

    // And the same file again adds none.
    const igen = await importeraSieFiler(db, kontext, [
      siefil(2026, { ib: DEKLARATION, verifikat: medProjekt(1, 2026, '{6 "P2026"}') }),
    ]);
    expect(igen.projekt).toBe(0);
    expect((await lasTillstand(db)).projekt.size).toBe(1);
  });

  it('makes a project of an object a line uses but the file never declared', async () => {
    await importeraSieFiler(db, kontext, [
      siefil(2026, { verifikat: medProjekt(1, 2026, '{6 "X1"}') }),
    ]);
    expect([...(await lasTillstand(db)).projekt.values()]).toMatchObject([
      { kod: 'X1', namn: 'X1' },
    ]);
  });

  it('writes an object number that is not a usable code as one that is, and says so', async () => {
    const resultat = await importeraSieFiler(db, kontext, [
      siefil(2026, {
        ib: ['#DIM 6 "Projekt"', '#OBJEKT 6 "Läger 1/2026" "Läger"'],
        verifikat: medProjekt(1, 2026, '{6 "Läger 1/2026"}'),
      }),
    ]);
    const [projekt] = [...(await lasTillstand(db)).projekt.values()];
    expect(projekt?.kod).toBe('Läger-1-2026');
    expect(resultat.varningar.join(' ')).toContain(
      '"Läger 1/2026" skrevs som Läger-1-2026',
    );
    const [verifikat] = [...(await lasTillstand(db)).verifikat.values()];
    expect(verifikat?.konteringar.find((rad) => rad.konto === '4010')?.projekt).toBe(
      projekt?.id,
    );
  });

  it('says that another dimension is not read, once, and leaves its lines without a project', async () => {
    const resultat = await importeraSieFiler(db, kontext, [
      siefil(2026, {
        ib: ['#DIM 1 "Kostnadsställe"', '#OBJEKT 1 "456" "Fastigheten"'],
        verifikat: [
          ...medProjekt(1, 2026, '{1 "456"}'),
          ...medProjekt(2, 2026, '{1 "456"}'),
        ],
      }),
    ]);
    expect(resultat.projekt).toBe(0);
    const varningar = resultat.varningar.filter((text) => text.includes('dimension 1'));
    expect(varningar).toHaveLength(1);
    expect(varningar[0]).toContain('Kostnadsställe');
    for (const verifikat of (await lasTillstand(db)).verifikat.values()) {
      expect(verifikat.konteringar.every((rad) => rad.projekt === undefined)).toBe(true);
    }
  });

  it('keeps the project when a line names two dimensions', async () => {
    await importeraSieFiler(db, kontext, [
      siefil(2026, {
        ib: DEKLARATION,
        verifikat: medProjekt(1, 2026, '{"1" "456" "6" "P2026"}'),
      }),
    ]);
    const tillstand = await lasTillstand(db);
    const [projekt] = [...tillstand.projekt.values()];
    const [verifikat] = [...tillstand.verifikat.values()];
    expect(verifikat?.konteringar.find((rad) => rad.konto === '4010')?.projekt).toBe(
      projekt?.id,
    );
  });

  it('gives the same projects back out, and a second book reads them in again', async () => {
    await importeraSieFiler(db, kontext, [
      siefil(2026, { ib: DEKLARATION, verifikat: medProjekt(1, 2026, '{6 "P2026"}') }),
    ]);
    const ar = [...(await lasTillstand(db)).rakenskapsar.values()][0]!;
    const fil = await exporteraSie(db, ar.id);

    const ny = new KonteraDatabase(`kontera-sieimport-projekt-${(raknare += 1)}`);
    skyddaBokfordaVerifikat(ny);
    await ny.open();
    await importeraSieFiler(ny, kontext, [fil]);

    const tillstand = await lasTillstand(ny);
    expect([...tillstand.projekt.values()]).toMatchObject([
      { kod: 'P2026', namn: 'Ungdomsläger 2026' },
    ]);
    const [verifikat] = [...tillstand.verifikat.values()];
    expect(
      verifikat?.konteringar.filter((rad) => rad.projekt !== undefined),
    ).toHaveLength(1);
    ny.close();
  });
});
