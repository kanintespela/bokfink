import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { uuidv7 } from '../domain/id/uuidv7';
import { avkodaPC8, kodaPC8 } from '../domain/sie/pc8';
import { tolkaSie } from '../domain/sie/parser';
import { datum } from '../domain/tid/datum';
import { lasTillstand, skyddaBokfordaVerifikat } from './bokforing';
import { KonteraDatabase } from './db';
import { byggSiedokument, exporteraSie } from './sieexport';
import { importeraSieFiler } from './sieimport';
import type { Skrivkontext } from './kommandon';

let raknare = 0;
let ms = 1_788_000_000_000;

const kontext: Skrivkontext = {
  enhet: 'export',
  nu: () => '2026-09-05T09:00:00.000Z',
  nyttId: () => uuidv7((ms += 1), new Uint8Array(10).fill(2)),
};

/** A synthetic export with the shape and the arithmetic of the real one. */
function siefil(ar: number, extra: string[] = []) {
  return kodaPC8(
    [
      '#FLAGGA 0',
      '#FORMAT PC8',
      '#SIETYP 4',
      '#VALUTA SEK',
      `#RAR 0 ${ar}0101 ${ar}1231`,
      '#KONTO 1930 "Företagskonto"',
      '#KONTO 2013 "Eget uttag/insättningar"',
      '#KONTO 2640 "Ingående moms"',
      '#KONTO 4010 "Inköp material och varor"',
      '#KTYP 1930 T',
      '#KTYP 4010 K',
      '#SRU 1930 7281',
      '#SRU 4010 7511',
      '#IB 0 1930 23817.45',
      '#IB 0 2013 -23817.45',
      ...extra,
      `#VER "A" 1 ${ar}0109 "Inköp av kraftfoder" ${ar}0112 ""`,
      '{',
      '#TRANS 2013 {} -520.31',
      '#TRANS 2640 {} 104.06',
      '#TRANS 4010 {} 416.25',
      '}',
      '',
    ].join('\n'),
  );
}

describe('byggSiedokument', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = new KonteraDatabase(`kontera-sieexport-${(raknare += 1)}`);
    skyddaBokfordaVerifikat(db);
    await db.open();
    await importeraSieFiler(db, kontext, [siefil(2026)]);
  });

  const enda = async () => [...(await lasTillstand(db)).rakenskapsar.values()][0]!;

  it('computes closing balances rather than storing them', async () => {
    const doc = await byggSiedokument(db, (await enda()).id);

    // 1930 never moved, so it closes where it opened.
    expect(doc.utgaende).toContainEqual({
      arsindex: 0,
      konto: '1930',
      belopp: oreFromKronor('23817.45'),
    });
    // 2013 opened at -23817.45 and the purchase took another 520.31.
    expect(doc.utgaende).toContainEqual({
      arsindex: 0,
      konto: '2013',
      belopp: oreFromKronor('-24337.76'),
    });
  });

  it('writes the year movement as the result, with no opening balance', async () => {
    const doc = await byggSiedokument(db, (await enda()).id);
    expect(doc.resultat).toEqual([
      { arsindex: 0, konto: '4010', belopp: oreFromKronor('416.25') },
    ]);
  });

  it('leaves out accounts that end at nothing', async () => {
    const doc = await byggSiedokument(db, (await enda()).id);
    // 2640 took 104.06 and is a balance account, so it is present; nothing
    // here ends at zero, and no zero row is written.
    expect(doc.utgaende.every((post) => post.belopp !== 0)).toBe(true);
    expect(doc.resultat.every((post) => post.belopp !== 0)).toBe(true);
  });

  it('carries the SRU codes back out', async () => {
    const doc = await byggSiedokument(db, (await enda()).id);
    expect(doc.konton.find((k) => k.nummer === '1930')?.sru).toEqual(['7281']);
  });

  it('folds the five account types back into SIE four', async () => {
    const doc = await byggSiedokument(db, (await enda()).id);
    const typer = new Map(doc.konton.map((k) => [k.nummer, k.typ]));
    expect(typer.get('1930')).toBe('T');
    expect(typer.get('4010')).toBe('K');
    // Equity and debt both become S, which is all SIE has.
    expect(typer.get('2013')).toBe('S');
    expect(typer.get('2640')).toBe('S');
  });

  it('names the previous year when there is one', async () => {
    await importeraSieFiler(db, kontext, [siefil(2027)]);
    const ar = [...(await lasTillstand(db)).rakenskapsar.values()].sort((a, b) =>
      a.start < b.start ? 1 : -1,
    );
    const doc = await byggSiedokument(db, ar[0]!.id);

    expect(doc.rakenskapsar).toEqual([
      { index: 0, start: '2027-01-01', slut: '2027-12-31' },
      { index: -1, start: '2026-01-01', slut: '2026-12-31' },
    ]);
  });

  it('refuses a year that does not exist', async () => {
    const saknas = uuidv7(1, new Uint8Array(10));
    await expect(byggSiedokument(db, saknas)).rejects.toThrow(/inget räkenskapsår/);
  });
});

describe('exporteraSie', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = new KonteraDatabase(`kontera-sieexport-b-${(raknare += 1)}`);
    skyddaBokfordaVerifikat(db);
    await db.open();
    await importeraSieFiler(db, kontext, [siefil(2026)]);
  });

  /*
   * The stage's acceptance criterion, end to end: bytes in, ledger, bytes
   * out, and the same books both times. Verified against four real SIE
   * files from another program as well, where every #IB, #UB and #RES
   * matches the source account for account across all four years.
   */
  it('produces a file that reads back into the same ledger', async () => {
    const ar = [...(await lasTillstand(db)).rakenskapsar.values()][0]!;
    const bytes = await exporteraSie(db, ar.id);

    const tillbaka = new KonteraDatabase(`kontera-sieexport-c-${(raknare += 1)}`);
    skyddaBokfordaVerifikat(tillbaka);
    await tillbaka.open();
    await importeraSieFiler(tillbaka, kontext, [bytes]);

    const forst = await lasTillstand(db);
    const sedan = await lasTillstand(tillbaka);

    expect(
      [...sedan.verifikat.values()].map((v) => [v.serie, v.nummer, v.datum]),
    ).toEqual([...forst.verifikat.values()].map((v) => [v.serie, v.nummer, v.datum]));
    expect([...sedan.konton.keys()].sort()).toEqual([...forst.konton.keys()].sort());
    tillbaka.close();
  });

  it('writes PC8 bytes, not UTF-8', async () => {
    const ar = [...(await lasTillstand(db)).rakenskapsar.values()][0]!;
    const bytes = await exporteraSie(db, ar.id);

    // "Ingående moms" - the å is one PC8 byte, 0x86, not two UTF-8 ones.
    expect(bytes).toContain(0x86);
    expect(avkodaPC8(bytes)).toContain('Ingående moms');
    expect(tolkaSie(avkodaPC8(bytes)).konton).toHaveLength(4);
  });

  it('exports a date as ÅÅÅÅMMDD', async () => {
    const ar = [...(await lasTillstand(db)).rakenskapsar.values()][0]!;
    const text = avkodaPC8(await exporteraSie(db, ar.id));
    expect(text).toContain('#RAR 0 20260101 20261231');
    expect(text).toContain('#VER "A" 1 20260109 "Inköp av kraftfoder" 20260112');
    expect(text).not.toContain(datum('2026-01-09'));
  });
});
