import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import {
  PeriodLastError,
  FramtidaDatumError,
  skapaRakenskapsar,
  type Rakenskapsar,
} from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { bokforBokslutspost } from './bokslutspost';
import { lasTillstand, skyddaBokfordaVerifikat } from './bokforing';
import { KonteraDatabase } from './db';
import { momslas, skrivKonto, skrivRakenskapsar, type Skrivkontext } from './kommandon';

let raknare = 0;
let klockslag = 1_789_000_000_000;

const kontext = (idag: string): Skrivkontext => ({
  enhet: 'enhet-a',
  nu: () => '2027-01-20T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(2)),
  idag: () => datum(idag),
});

const faktura = {
  typ: 'obetald_kundfaktura' as const,
  belopp: oreFromKronor('12500'),
  momssats: 25,
  motkonto: kontonummer('3010'),
  balanskonto: kontonummer('1510'),
};

describe('bokforBokslutspost', () => {
  let db: KonteraDatabase;
  let ar: Rakenskapsar;

  beforeEach(async () => {
    db = new KonteraDatabase(`kontera-bokslutspost-${(raknare += 1)}`);
    skyddaBokfordaVerifikat(db);
    await db.open();
    ar = skapaRakenskapsar({
      id: '019b76da-a800-7000-8000-000000002026' as Uuid,
      start: datum('2026-01-01'),
      slut: datum('2026-12-31'),
    });
    await skrivRakenskapsar(db, kontext('2027-01-20'), ar);
    for (const [nummer, namn] of [
      ['1510', 'Kundfordringar'],
      ['3010', 'Försäljning'],
      ['2610', 'Utgående moms 25 %'],
    ] as const) {
      await skrivKonto(db, kontext('2027-01-20'), skapaKonto({ nummer, namn }));
    }
  });

  /*
   * The whole point of the owner's choice: one press takes the invoice up on
   * the year's last day and reverses it on the next year's first, so that
   * paying it in January counts once.
   */
  it('books the item on 31 December and its reversal on 1 January', async () => {
    const { verifikat, aterforing } = await bokforBokslutspost(
      db,
      kontext('2027-01-20'),
      ar,
      faktura,
      'Faktura 1042, Hansson',
      verifikatserie('A'),
    );

    expect(verifikat.datum).toBe('2026-12-31');
    expect(aterforing.datum).toBe('2027-01-01');
    expect(aterforing.beskrivning).toBe('Återföring: Faktura 1042, Hansson');
    expect(aterforing.konteringar.map((rad) => rad.belopp)).toEqual(
      verifikat.konteringar.map((rad) => -rad.belopp),
    );
    expect(aterforing.nummer).toBe(1);
    expect((await lasTillstand(db)).rakenskapsar.size).toBe(2);
  });

  it('refuses before the new year has started, since the reversal would be in the future', async () => {
    await expect(
      bokforBokslutspost(
        db,
        kontext('2026-12-31'),
        ar,
        faktura,
        'x',
        verifikatserie('A'),
      ),
    ).rejects.toThrow(FramtidaDatumError);
    expect((await lasTillstand(db)).verifikat.size).toBe(0);
    expect((await lasTillstand(db)).rakenskapsar.size).toBe(1);
  });

  /*
   * An invoice's moms belongs in the year's last declaration. With that
   * declaration locked, nothing is booked - neither half.
   */
  it('books neither half when the year-end half is refused', async () => {
    await momslas(db, kontext('2027-01-20'), ar.id, datum('2026-12-31'));

    await expect(
      bokforBokslutspost(
        db,
        kontext('2027-01-20'),
        ar,
        faktura,
        'x',
        verifikatserie('A'),
      ),
    ).rejects.toThrow(PeriodLastError);
    expect((await lasTillstand(db)).verifikat.size).toBe(0);
  });
});
