import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { LoggkonfliktError } from '../domain/handelse/handelse';
import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import { skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast } from '../domain/verifikat/verifikat';
import {
  OforanderligtUnderlagError,
  sha256,
  type Sha256,
} from '../domain/underlag/underlag';
import { lasLogg, lasTillstand } from './bokforing';
import { KonteraDatabase } from './db';
import {
  bokforUtkast,
  skrivKonto,
  skrivRakenskapsar,
  sparaUtkast,
  type Skrivkontext,
} from './kommandon';
import {
  frikopplaUnderlag,
  kasseraUtkast,
  kopplaUnderlag,
  lasFil,
  lasUnderlag,
  okoppladeUnderlag,
  sparaUnderlag,
  sparaForfallodag,
  sparaUnderlagstext,
  taBortUnderlag,
  underlagForVerifikat,
} from './underlag';

let raknare = 0;
let klockslag = 1_788_554_000_000;

const kontext: Skrivkontext = {
  enhet: 'enhet-a',
  nu: () => '2026-09-05T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(5)),
};

const VERIFIKAT_A = '019b76da-a800-7000-8000-00000000000a' as Uuid;
const VERIFIKAT_B = '019b76da-a800-7000-8000-00000000000b' as Uuid;

const bytes = (text: string) => new TextEncoder().encode(text);

/** The hash is the caller's business, so tests can state one outright. */
const hash = (tecken: string): Sha256 => sha256(tecken.repeat(64));

const fil = (tecken = 'a', innehall = 'kvitto') => ({
  sha256: hash(tecken),
  mime: 'image/jpeg',
  filnamn: 'kvitto.jpg',
  data: bytes(innehall),
});

describe('underlag', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = new KonteraDatabase(`kontera-underlag-${(raknare += 1)}`);
    await db.open();
  });

  it('stores the file beside the log and the metadata in it', async () => {
    const { underlag, nytt } = await sparaUnderlag(db, kontext, fil());
    expect(nytt).toBe(true);

    const rad = await lasFil(db, underlag.sha256);
    expect(rad?.data).toEqual(bytes('kvitto'));
    expect(rad?.mime).toBe('image/jpeg');

    const logg = await lasLogg(db);
    expect(logg.map((post) => post.typ)).toEqual(['underlag.tillagt']);
    expect(underlag.storlek).toBe(bytes('kvitto').byteLength);
  });

  /*
   * The point of addressing files by content: the same receipt photographed
   * again, or arriving on a second device, is the file already stored.
   */
  it('recognises a file it already has', async () => {
    const { underlag: forst } = await sparaUnderlag(db, kontext, fil());
    await kopplaUnderlag(db, kontext, forst.id, VERIFIKAT_A);
    const igen = await sparaUnderlag(db, kontext, fil());

    expect(igen.nytt).toBe(false);
    expect(igen.underlag.id).toBe(forst.id);
    // The links the first one collected survive the second attempt.
    expect(igen.underlag.verifikat).toEqual([VERIFIKAT_A]);
    expect(
      (await lasLogg(db)).filter((post) => post.typ === 'underlag.tillagt'),
    ).toHaveLength(1);
  });

  it('links an underlag to several verifikat and back again', async () => {
    const { underlag } = await sparaUnderlag(db, kontext, fil());
    await kopplaUnderlag(db, kontext, underlag.id, VERIFIKAT_A);
    await kopplaUnderlag(db, kontext, underlag.id, VERIFIKAT_B);

    expect(await underlagForVerifikat(db, VERIFIKAT_A)).toHaveLength(1);
    expect(await underlagForVerifikat(db, VERIFIKAT_B)).toHaveLength(1);

    await frikopplaUnderlag(db, kontext, underlag.id, VERIFIKAT_A);
    expect(await underlagForVerifikat(db, VERIFIKAT_A)).toEqual([]);
    expect(await underlagForVerifikat(db, VERIFIKAT_B)).toHaveLength(1);
  });

  it('lists what has been photographed but not booked yet', async () => {
    const { underlag: okopplat } = await sparaUnderlag(db, kontext, fil('a'));
    const { underlag: kopplat } = await sparaUnderlag(db, kontext, fil('b', 'faktura'));
    await kopplaUnderlag(db, kontext, kopplat.id, VERIFIKAT_A);

    expect((await okoppladeUnderlag(db)).map((post) => post.id)).toEqual([okopplat.id]);
  });

  it('records what OCR read', async () => {
    const { underlag } = await sparaUnderlag(db, kontext, fil());
    await sparaUnderlagstext(db, kontext, underlag.id, 'ICA Kvantum 249,00');

    const tillstand = await lasTillstand(db);
    expect(tillstand.underlag.get(underlag.id)?.text).toBe('ICA Kvantum 249,00');
  });

  it('records a due date as its own entry, and removes it', async () => {
    const { underlag } = await sparaUnderlag(db, kontext, fil());
    await sparaForfallodag(db, kontext, underlag.id, datum('2026-03-15'));

    expect((await lasUnderlag(db, underlag.id))?.forfallodag).toBe('2026-03-15');
    expect((await lasLogg(db)).at(-1)).toMatchObject({
      typ: 'underlag.forfallodag',
      underlagId: underlag.id,
      forfallodag: '2026-03-15',
      enhet: 'enhet-a',
    });

    await sparaForfallodag(db, kontext, underlag.id, undefined);
    expect((await lasUnderlag(db, underlag.id))?.forfallodag).toBeUndefined();
    expect(
      (await lasTillstand(db)).underlag.get(underlag.id)?.forfallodag,
    ).toBeUndefined();
  });

  /*
   * Hard rule 11. A link to a file the log never added is a broken log, and
   * has to say so rather than quietly drop the link.
   */
  it('refuses to link an underlag the log does not know', async () => {
    await expect(
      kopplaUnderlag(db, kontext, VERIFIKAT_A, VERIFIKAT_B),
    ).rejects.toBeInstanceOf(LoggkonfliktError);
  });

  it('refuses a file type that cannot be archived', async () => {
    await expect(
      sparaUnderlag(db, kontext, { ...fil(), mime: 'image/heic' }),
    ).rejects.toThrow(/image\/heic/);
    expect(await lasFil(db, hash('a'))).toBeUndefined();
  });

  /*
   * A mis-shot is a picture, not räkenskapsinformation. A list that cannot be
   * tidied stops being read, and an unbooked photograph is nobody's evidence.
   */
  it('throws away a receipt no verifikat has claimed, bytes and all', async () => {
    const { underlag } = await sparaUnderlag(db, kontext, fil());

    await taBortUnderlag(db, kontext, underlag.id);

    expect(await lasUnderlag(db, underlag.id)).toBeUndefined();
    expect(await lasFil(db, underlag.sha256)).toBeUndefined();
    expect(await okoppladeUnderlag(db)).toEqual([]);
  });

  /*
   * The other side of the same line. Bokföringslagen 7 kap. 2 §: what a booked
   * verifikat rests on is kept for seven years, and no button gets to shorten
   * that.
   */
  it('refuses to remove the evidence for a booked verifikat', async () => {
    const { underlag } = await sparaUnderlag(db, kontext, fil());
    await kopplaUnderlag(db, kontext, underlag.id, VERIFIKAT_A);

    await expect(taBortUnderlag(db, kontext, underlag.id)).rejects.toBeInstanceOf(
      OforanderligtUnderlagError,
    );
    expect(await lasUnderlag(db, underlag.id)).toBeDefined();
    expect(await lasFil(db, underlag.sha256)).toBeDefined();
  });

  it('is quiet about removing something that is already gone', async () => {
    const { underlag } = await sparaUnderlag(db, kontext, fil());
    await taBortUnderlag(db, kontext, underlag.id);
    await expect(taBortUnderlag(db, kontext, underlag.id)).resolves.toBeUndefined();
  });

  /*
   * Content addressing means the same picture added twice is one row, so
   * removing it does leave nothing pointing at those bytes. The check before
   * deleting them is what keeps that true if two rows ever share a file.
   */
  it('removes the bytes when the last row pointing at them goes', async () => {
    const { underlag } = await sparaUnderlag(db, kontext, fil());
    await sparaUnderlag(db, kontext, fil());

    await taBortUnderlag(db, kontext, underlag.id);
    expect(await lasFil(db, underlag.sha256)).toBeUndefined();
  });

  describe('an utkast with its receipt', () => {
    const utkast = () =>
      skapaUtkast({
        id: uuidv7((klockslag += 1), new Uint8Array(10).fill(7)),
        datum: datum('2026-09-04'),
        beskrivning: 'Foder, Lantmännen',
        konteringar: [
          { konto: kontonummer('4010'), belopp: oreFromKronor('400.00') },
          { konto: kontonummer('2640'), belopp: oreFromKronor('100.00') },
          { konto: kontonummer('2013'), belopp: oreFromKronor('-500.00') },
        ],
      });

    beforeEach(async () => {
      await skrivRakenskapsar(
        db,
        kontext,
        skapaRakenskapsar({
          id: '019b76da-a800-7000-8000-000000002026' as Uuid,
          start: datum('2026-01-01'),
          slut: datum('2026-12-31'),
        }),
      );
      for (const [nummer, namn] of [
        ['4010', 'Inköp'],
        ['2640', 'Ingående moms'],
        ['2013', 'Eget uttag'],
      ] as const) {
        await skrivKonto(db, kontext, skapaKonto({ nummer, namn }));
      }
    });

    /*
     * Booking keeps the draft's id, so a receipt linked to the draft is the
     * evidence for the verifikat the moment it is booked - with no step in
     * between that could be forgotten.
     */
    it('becomes the evidence for the verifikat the draft is booked as', async () => {
      const forslag = utkast();
      await sparaUtkast(db, kontext, forslag);
      const { underlag } = await sparaUnderlag(db, kontext, fil());
      await kopplaUnderlag(db, kontext, underlag.id, forslag.id);

      expect(await okoppladeUnderlag(db)).toEqual([]);

      const verifikat = await bokforUtkast(db, kontext, forslag, verifikatserie('A'));
      expect(
        (await underlagForVerifikat(db, verifikat.id)).map((post) => post.id),
      ).toEqual([underlag.id]);
      expect((await lasTillstand(db)).utkast.size).toBe(0);
    });

    it('goes back to waiting when the draft is thrown away', async () => {
      const forslag = utkast();
      await sparaUtkast(db, kontext, forslag);
      const { underlag } = await sparaUnderlag(db, kontext, fil());
      await kopplaUnderlag(db, kontext, underlag.id, forslag.id);

      await kasseraUtkast(db, kontext, forslag.id);

      expect((await lasTillstand(db)).utkast.size).toBe(0);
      expect((await okoppladeUnderlag(db)).map((post) => post.id)).toEqual([underlag.id]);
      expect(await lasFil(db, underlag.sha256)).toBeDefined();
    });

    /*
     * One receipt can be evidence for two things. Throwing one draft away
     * must not take the receipt from the other.
     */
    it('keeps the links a receipt has to anything else', async () => {
      const forslag = utkast();
      await sparaUtkast(db, kontext, forslag);
      const { underlag } = await sparaUnderlag(db, kontext, fil());
      await kopplaUnderlag(db, kontext, underlag.id, VERIFIKAT_A);
      await kopplaUnderlag(db, kontext, underlag.id, forslag.id);

      await kasseraUtkast(db, kontext, forslag.id);

      expect((await lasUnderlag(db, underlag.id))?.verifikat).toEqual([VERIFIKAT_A]);
    });

    it('is quiet about a draft that is already gone', async () => {
      const forslag = utkast();
      await sparaUtkast(db, kontext, forslag);
      await kasseraUtkast(db, kontext, forslag.id);

      await expect(kasseraUtkast(db, kontext, forslag.id)).resolves.toBeUndefined();
    });
  });
});
