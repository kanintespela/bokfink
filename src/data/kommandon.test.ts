import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import {
  FramtidaDatumError,
  PeriodLastError,
  skapaRakenskapsar,
} from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { beteckning, skapaUtkast } from '../domain/verifikat/verifikat';
import { lasTillstand, skyddaBokfordaVerifikat } from './bokforing';
import { tillampaMall } from '../domain/mall/konteringsmall';
import { KonteraDatabase } from './db';
import {
  annulleraVerifikat,
  bokforUtkast,
  rattaVerifikat,
  mallanvandning,
  sparaMall,
  taBortMall,
  hogstaNummer,
  momslas,
  serieForEnhet,
  sattIngaendeBalanser,
  sattSerieForEnhet,
  skrivKonto,
  skrivRakenskapsar,
  sparaUtkast,
  borttagbaraRakenskapsar,
  EndaAretError,
  taBortRakenskapsar,
  taBortUtkast,
  TomtArKravsError,
  type Skrivkontext,
} from './kommandon';

let raknare = 0;
let klockslag = 1_788_554_000_000;

const kontext: Skrivkontext = {
  enhet: 'enhet-a',
  nu: () => '2026-09-05T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(5)),
};

const AR_2026 = '019b76da-a800-7000-8000-000000002026' as Uuid;

const utkast = (datumtext: string, id?: Uuid) =>
  skapaUtkast({
    id: id ?? kontext.nyttId!(),
    datum: datum(datumtext),
    beskrivning: 'Inköp av kraftfoder',
    konteringar: [
      { konto: kontonummer('4010'), belopp: oreFromKronor('416.25') },
      { konto: kontonummer('2013'), belopp: oreFromKronor('-416.25') },
    ],
  });

describe('kommandon', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = new KonteraDatabase(`kontera-kommandon-${(raknare += 1)}`);
    skyddaBokfordaVerifikat(db);
    await db.open();
    await skrivRakenskapsar(
      db,
      kontext,
      skapaRakenskapsar({
        id: AR_2026,
        start: datum('2026-01-01'),
        slut: datum('2026-12-31'),
      }),
    );
    await skrivKonto(db, kontext, skapaKonto({ nummer: '4010', namn: 'Inköp' }));
    await skrivKonto(db, kontext, skapaKonto({ nummer: '2013', namn: 'Eget uttag' }));
  });

  it('hands out an unbroken run of numbers', async () => {
    const A = verifikatserie('A');
    const ett = await bokforUtkast(db, kontext, utkast('2026-01-09'), A);
    const tva = await bokforUtkast(db, kontext, utkast('2026-02-13'), A);
    const tre = await bokforUtkast(db, kontext, utkast('2026-03-01'), A);

    expect([ett, tva, tre].map(beteckning)).toEqual(['A1', 'A2', 'A3']);
    expect(await hogstaNummer(db, AR_2026, A)).toBe(3);
  });

  /*
   * Latent until something reads it back: mallanvandning counts from the log,
   * so the shortcuts kept working while the table quietly lost the field.
   * utanIndexnyckel lists its fields precisely so a new one fails loudly, but
   * an optional one goes missing instead of failing.
   */
  it('keeps the template a verifikat was booked from when read back', async () => {
    const mallId = kontext.nyttId!();
    const bokfort = await bokforUtkast(
      db,
      kontext,
      { ...utkast('2026-09-16'), mall: mallId },
      verifikatserie('A'),
    );

    expect(bokfort.mall).toBe(mallId);
    expect((await lasTillstand(db)).verifikat.get(bokfort.id)?.mall).toBe(mallId);
  });

  describe('rattaVerifikat', () => {
    const A = verifikatserie('A');

    /*
     * Carries ingående moms, because the momslås only stops what could change
     * a filed declaration - a verifikat that reaches no box is not in one.
     */
    const medMoms = (datumtext: string) =>
      skapaUtkast({
        id: kontext.nyttId!(),
        datum: datum(datumtext),
        beskrivning: 'Inköp av kraftfoder',
        konteringar: [
          { konto: kontonummer('5400'), belopp: oreFromKronor('2580.00') },
          { konto: kontonummer('2641'), belopp: oreFromKronor('645.00') },
          { konto: kontonummer('2013'), belopp: oreFromKronor('-3225.00') },
        ],
      });

    it('corrects the description and leaves the money alone', async () => {
      const original = await bokforUtkast(db, kontext, utkast('2026-09-16'), A);

      const rattat = await rattaVerifikat(db, kontext, original, {
        beskrivning: 'Swedol AB',
      });

      expect(rattat.beskrivning).toBe('Swedol AB');
      expect(rattat.konteringar).toEqual(original.konteringar);
      expect(beteckning(rattat)).toBe(beteckning(original));

      // And it survives a replay of the log, which is the real store.
      const ur = (await lasTillstand(db)).verifikat.get(original.id);
      expect(ur?.beskrivning).toBe('Swedol AB');
      expect(ur?.rattelser?.[0]).toMatchObject({
        falt: 'beskrivning',
        fran: 'Inköp av kraftfoder',
        till: 'Swedol AB',
        enhet: 'enhet-a',
        nar: '2026-09-05T08:00:00.000Z',
      });
    });

    it('corrects the date within the year', async () => {
      const original = await bokforUtkast(db, kontext, utkast('2026-09-16'), A);

      const rattat = await rattaVerifikat(db, kontext, original, {
        datum: datum('2026-09-11'),
      });

      expect(rattat.datum).toBe('2026-09-11');
      expect((await lasTillstand(db)).verifikat.get(original.id)?.datum).toBe(
        '2026-09-11',
      );
    });

    /*
     * Hard rule 6: a verifikationsnummer is unique within its serie and year,
     * so a date that crosses a year boundary would carry a number belonging
     * to the other year's run.
     */
    it('refuses to move a verifikat into another räkenskapsår', async () => {
      await skrivRakenskapsar(
        db,
        kontext,
        skapaRakenskapsar({
          id: '019b76da-a800-7000-8000-000000002025' as Uuid,
          start: datum('2025-01-01'),
          slut: datum('2025-12-31'),
        }),
      );
      const original = await bokforUtkast(db, kontext, utkast('2026-01-09'), A);

      await expect(
        rattaVerifikat(db, kontext, original, { datum: datum('2025-12-31') }),
      ).rejects.toThrow(PeriodLastError);
    });

    it('refuses to move a verifikat into a filed momsdeklaration', async () => {
      const original = await bokforUtkast(db, kontext, medMoms('2026-09-16'), A);
      await momslas(db, kontext, AR_2026, datum('2026-06-30'));

      await expect(
        rattaVerifikat(db, kontext, original, { datum: datum('2026-05-04') }),
      ).rejects.toThrow(PeriodLastError);
    });

    /*
     * The half that only checking the new date would miss. Taking an entry
     * out of a filed period changes a reported figure just as surely as
     * putting one in.
     */
    it('refuses to move a verifikat out of a filed momsdeklaration', async () => {
      const original = await bokforUtkast(db, kontext, medMoms('2026-05-04'), A);
      await momslas(db, kontext, AR_2026, datum('2026-06-30'));

      await expect(
        rattaVerifikat(db, kontext, original, { datum: datum('2026-09-16') }),
      ).rejects.toThrow(PeriodLastError);
    });

    it('still lets the description be corrected inside a locked period', async () => {
      const original = await bokforUtkast(db, kontext, medMoms('2026-05-04'), A);
      await momslas(db, kontext, AR_2026, datum('2026-06-30'));

      const rattat = await rattaVerifikat(db, kontext, original, {
        beskrivning: 'Swedol AB',
      });

      // The lock keeps a filed declaration true; a description is not in one.
      expect(rattat.beskrivning).toBe('Swedol AB');
    });
  });

  it('keeps each series counting on its own, which is one per device', async () => {
    const a = await bokforUtkast(db, kontext, utkast('2026-01-09'), verifikatserie('A'));
    const b = await bokforUtkast(db, kontext, utkast('2026-01-10'), verifikatserie('B'));

    expect(beteckning(a)).toBe('A1');
    expect(beteckning(b)).toBe('B1');
  });

  it('numbers by booking order even when the dates go backwards', async () => {
    const A = verifikatserie('A');
    const senare = await bokforUtkast(db, kontext, utkast('2026-03-19'), A);
    const tidigare = await bokforUtkast(db, kontext, utkast('2026-01-08'), A);

    expect(beteckning(senare)).toBe('A1');
    expect(beteckning(tidigare)).toBe('A2');
    expect(tidigare.datum < senare.datum).toBe(true);
  });

  it('refuses to book what reaches the momsdeklaration into a locked period', async () => {
    await momslas(db, kontext, AR_2026, datum('2026-03-31'));
    const medMoms = skapaUtkast({
      id: kontext.nyttId!(),
      datum: datum('2026-02-01'),
      beskrivning: 'Inköp av kraftfoder',
      konteringar: [
        { konto: kontonummer('4010'), belopp: oreFromKronor('400') },
        { konto: kontonummer('2640'), belopp: oreFromKronor('100') },
        { konto: kontonummer('2013'), belopp: oreFromKronor('-500') },
      ],
    });
    await expect(bokforUtkast(db, kontext, medMoms, verifikatserie('A'))).rejects.toThrow(
      PeriodLastError,
    );
  });

  /*
   * A booking dated in the future is a typo far more often than a plan, and
   * one that goes through lands in a period nobody is looking at.
   */
  it('refuses a date after today when the context knows today', async () => {
    const medIdag: Skrivkontext = { ...kontext, idag: () => datum('2026-04-05') };
    await expect(
      bokforUtkast(db, medIdag, utkast('2026-12-24'), verifikatserie('A')),
    ).rejects.toThrow(FramtidaDatumError);
    await expect(
      bokforUtkast(db, medIdag, utkast('2026-04-05'), verifikatserie('A')),
    ).resolves.toMatchObject({ nummer: 1 });
  });

  it('books an entry that reaches no momsdeklaration box into a VAT-locked period', async () => {
    await skrivKonto(
      db,
      kontext,
      skapaKonto({ nummer: '1790', namn: 'Förutbetalda kostnader' }),
    );
    await momslas(db, kontext, AR_2026, datum('2026-12-31'));

    const periodisering = skapaUtkast({
      id: kontext.nyttId!(),
      datum: datum('2026-12-31'),
      beskrivning: 'Periodisering',
      konteringar: [
        { konto: kontonummer('1790'), belopp: oreFromKronor('6000') },
        { konto: kontonummer('4010'), belopp: oreFromKronor('-6000') },
      ],
    });
    await expect(
      bokforUtkast(db, kontext, periodisering, verifikatserie('A')),
    ).resolves.toMatchObject({ nummer: 1 });
  });

  it('refuses to book outside every fiscal year', async () => {
    await expect(
      bokforUtkast(db, kontext, utkast('2027-01-01'), verifikatserie('A')),
    ).rejects.toThrow(/räkenskapsår/);
  });

  it('consumes the draft when it is booked', async () => {
    const id = kontext.nyttId!();
    await sparaUtkast(db, kontext, utkast('2026-01-09', id));
    expect((await lasTillstand(db)).utkast.size).toBe(1);

    await bokforUtkast(db, kontext, utkast('2026-01-09', id), verifikatserie('A'));
    const tillstand = await lasTillstand(db);
    expect(tillstand.utkast.size).toBe(0);
    expect(tillstand.verifikat.size).toBe(1);
  });

  it('removes a draft that is abandoned rather than booked', async () => {
    const id = kontext.nyttId!();
    await sparaUtkast(db, kontext, utkast('2026-01-09', id));
    await taBortUtkast(db, kontext, id);
    expect((await lasTillstand(db)).utkast.size).toBe(0);
  });

  it('books an annulment as the next number in the same series', async () => {
    const A = verifikatserie('A');
    const original = await bokforUtkast(db, kontext, utkast('2026-01-09'), A);
    const annullering = await annulleraVerifikat(
      db,
      kontext,
      original,
      datum('2026-02-01'),
    );

    expect(beteckning(annullering)).toBe('A2');
    expect(annullering.annullerar).toBe(original.id);

    // Both stay in the books; the pair nets to nothing.
    const tillstand = await lasTillstand(db);
    expect(tillstand.verifikat.size).toBe(2);
  });

  it('remembers which series this device uses', async () => {
    expect(await serieForEnhet(db)).toBeUndefined();
    await sattSerieForEnhet(db, verifikatserie('B'));
    expect(await serieForEnhet(db)).toBe('B');
  });
});

describe('konteringsmallar', () => {
  let db: KonteraDatabase;

  const MALL_ID = '019b76da-a800-7000-8000-0000000000f1' as Uuid;

  const foder = {
    id: MALL_ID,
    namn: 'Inköp av foder',
    sokord: ['kraftfoder'],
    riktning: 'utgift' as const,
    konto: kontonummer('4010'),
    momssats: 25,
    momskonto: kontonummer('2640'),
  };

  beforeEach(async () => {
    db = new KonteraDatabase(`kontera-mall-${(raknare += 1)}`);
    skyddaBokfordaVerifikat(db);
    await db.open();
    await skrivRakenskapsar(
      db,
      kontext,
      skapaRakenskapsar({
        id: AR_2026,
        start: datum('2026-01-01'),
        slut: datum('2026-12-31'),
      }),
    );
  });

  it('stores and removes a template', async () => {
    await sparaMall(db, kontext, foder);
    expect((await lasTillstand(db)).mallar.get(MALL_ID)?.namn).toBe('Inköp av foder');

    await taBortMall(db, kontext, MALL_ID);
    expect((await lasTillstand(db)).mallar.size).toBe(0);
  });

  it('lets a later version of a template win', async () => {
    await sparaMall(db, kontext, foder);
    await sparaMall(db, kontext, { ...foder, namn: 'Inköp av kraftfoder' });
    const mallar = (await lasTillstand(db)).mallar;
    expect(mallar.size).toBe(1);
    expect(mallar.get(MALL_ID)?.namn).toBe('Inköp av kraftfoder');
  });

  /*
   * The ranking signal, counted from the log rather than kept as a tally
   * beside it. A counter could fall out of step with the entries it counts.
   */
  it('counts how often each template actually booked something', async () => {
    await sparaMall(db, kontext, foder);
    expect(await mallanvandning(db)).toEqual(new Map());

    for (const dag of ['2026-01-09', '2026-02-13', '2026-03-01']) {
      const rader = tillampaMall(foder, {
        brutto: oreFromKronor('520.31'),
        betalkonto: kontonummer('2013'),
      });
      await bokforUtkast(
        db,
        kontext,
        skapaUtkast({
          id: kontext.nyttId!(),
          datum: datum(dag),
          beskrivning: 'Inköp av foder',
          konteringar: rader,
          mall: MALL_ID,
        }),
        verifikatserie('A'),
        'mall',
      );
    }

    expect(await mallanvandning(db)).toEqual(new Map([[MALL_ID, 3]]));
  });

  it('does not count verifikat that came from somewhere else', async () => {
    await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: kontext.nyttId!(),
        datum: datum('2026-01-09'),
        beskrivning: 'Manuellt',
        konteringar: [
          { konto: kontonummer('4010'), belopp: oreFromKronor('100.00') },
          { konto: kontonummer('2013'), belopp: oreFromKronor('-100.00') },
        ],
      }),
      verifikatserie('A'),
    );
    expect(await mallanvandning(db)).toEqual(new Map());
  });

  it('carries the template through to the booked verifikat', async () => {
    await sparaMall(db, kontext, foder);
    const verifikat = await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: kontext.nyttId!(),
        datum: datum('2026-01-09'),
        beskrivning: 'Inköp av foder',
        konteringar: tillampaMall(foder, {
          brutto: oreFromKronor('520.31'),
          betalkonto: kontonummer('2013'),
        }),
        mall: MALL_ID,
      }),
      verifikatserie('A'),
      'mall',
    );

    expect(verifikat.mall).toBe(MALL_ID);
    expect(verifikat.kalla).toBe('mall');
    expect(verifikat.konteringar).toHaveLength(3);
  });
});

async function nyDb(): Promise<KonteraDatabase> {
  const db = new KonteraDatabase(`kontera-kommandon-${(raknare += 1)}`);
  skyddaBokfordaVerifikat(db);
  await db.open();
  return db;
}

describe('taBortRakenskapsar', () => {
  /*
   * The pair this exists for: two devices each created their own "year that
   * covers today" before the identifier was derived from the date, and after
   * a sync the books held the same calendar year twice.
   */
  it('removes the empty half of a doubled year', async () => {
    const db = await nyDb();
    const behalls = '019b76da-a800-7000-8000-0000000000f0' as Uuid;
    const tomt = '019b76da-a800-7000-8000-0000000000f1' as Uuid;
    for (const id of [behalls, tomt]) {
      await skrivRakenskapsar(
        db,
        kontext,
        skapaRakenskapsar({
          id,
          start: datum('2026-01-01'),
          slut: datum('2026-12-31'),
        }),
      );
    }

    await taBortRakenskapsar(db, kontext, tomt);

    const kvar = (await lasTillstand(db)).rakenskapsar;
    expect(kvar.get(tomt)).toBeUndefined();
    expect(kvar.get(behalls)).toBeDefined();
  });

  /*
   * Removing the last year covering a date would leave nowhere to book, and
   * uppstart would recreate it with the same derived identifier - which sorts
   * before the removal, so it would stay gone and keep being recreated.
   */
  it('refuses to remove a year that is not a duplicate', async () => {
    const db = await nyDb();
    const ensamt = '019b76da-a800-7000-8000-0000000000f5' as Uuid;
    await skrivRakenskapsar(
      db,
      kontext,
      skapaRakenskapsar({
        id: ensamt,
        start: datum('2026-01-01'),
        slut: datum('2026-12-31'),
      }),
    );

    await expect(taBortRakenskapsar(db, kontext, ensamt)).rejects.toThrow(EndaAretError);
  });

  /*
   * The real case, which the first test missed: the two halves of a doubled
   * year cover exactly the same days, so a check by date finds the other
   * half's bookkeeping and refuses to remove anything at all.
   */
  it('removes the empty half even when the other half is full', async () => {
    const db = await nyDb();
    const full = '019b76da-a800-7000-8000-0000000000e1' as Uuid;
    const tomt = '019b76da-a800-7000-8000-0000000000e2' as Uuid;
    for (const id of [full, tomt]) {
      await skrivRakenskapsar(
        db,
        kontext,
        skapaRakenskapsar({
          id,
          start: datum('2026-01-01'),
          slut: datum('2026-12-31'),
        }),
      );
    }
    await skrivKonto(db, kontext, skapaKonto({ nummer: '1930', namn: 'Företagskonto' }));
    await skrivKonto(db, kontext, skapaKonto({ nummer: '3010', namn: 'Försäljning' }));
    await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: '019b76da-a800-7000-8000-0000000000e3' as Uuid,
        datum: datum('2026-03-01'),
        beskrivning: 'En försäljning',
        konteringar: [
          { konto: kontonummer('1930'), belopp: oreFromKronor('100') },
          { konto: kontonummer('3010'), belopp: oreFromKronor('-100') },
        ],
      }),
      verifikatserie('A'),
    );

    expect([...(await borttagbaraRakenskapsar(db))]).toEqual([tomt]);

    await taBortRakenskapsar(db, kontext, tomt);

    const kvar = (await lasTillstand(db)).rakenskapsar;
    expect(kvar.get(tomt)).toBeUndefined();
    expect(kvar.get(full)).toBeDefined();
  });

  /*
   * Bokföringslagen 7 kap. 2 §: what has been booked is kept for seven years.
   * The guard is what makes the removal safe to offer at all.
   */
  it('refuses a year with bookkeeping in it', async () => {
    const db = await nyDb();
    const ar = '019b76da-a800-7000-8000-0000000000f2' as Uuid;
    await skrivRakenskapsar(
      db,
      kontext,
      skapaRakenskapsar({
        id: ar,
        start: datum('2026-01-01'),
        slut: datum('2026-12-31'),
      }),
    );
    await skrivKonto(db, kontext, skapaKonto({ nummer: '1930', namn: 'Företagskonto' }));
    await skrivKonto(db, kontext, skapaKonto({ nummer: '3010', namn: 'Försäljning' }));
    await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: '019b76da-a800-7000-8000-0000000000f3' as Uuid,
        datum: datum('2026-03-01'),
        beskrivning: 'En försäljning',
        konteringar: [
          { konto: kontonummer('1930'), belopp: oreFromKronor('100') },
          { konto: kontonummer('3010'), belopp: oreFromKronor('-100') },
        ],
      }),
      verifikatserie('A'),
    );

    await expect(taBortRakenskapsar(db, kontext, ar)).rejects.toThrow(TomtArKravsError);
    expect((await lasTillstand(db)).rakenskapsar.get(ar)).toBeDefined();
  });

  /* Opening balances are bookkeeping too, even before anything is booked. */
  it('refuses a year that carries opening balances', async () => {
    const db = await nyDb();
    const ar = '019b76da-a800-7000-8000-0000000000f4' as Uuid;
    await skrivRakenskapsar(
      db,
      kontext,
      skapaRakenskapsar({
        id: ar,
        start: datum('2026-01-01'),
        slut: datum('2026-12-31'),
      }),
    );
    await sattIngaendeBalanser(db, kontext, ar, [
      { konto: kontonummer('1930'), belopp: oreFromKronor('1000') },
    ]);

    await expect(taBortRakenskapsar(db, kontext, ar)).rejects.toThrow(TomtArKravsError);
  });
});
