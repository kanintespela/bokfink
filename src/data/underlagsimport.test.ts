import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { sha256, type Sha256 } from '../domain/underlag/underlag';
import type { Importrad } from '../domain/underlag/underlagsimport';
import { lasLogg } from './bokforing';
import { KonteraDatabase } from './db';
import type { Skrivkontext } from './kommandon';
import { okoppladeUnderlag, underlagForVerifikat } from './underlag';
import { importeraUnderlag, type Importfil } from './underlagsimport';

let raknare = 0;
let klockslag = 1_788_554_000_000;

const kontext: Skrivkontext = {
  enhet: 'enhet-a',
  nu: () => '2026-09-12T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(5)),
};

const VERIFIKAT_A = '019b76da-a800-7000-8000-00000000000a' as Uuid;
const VERIFIKAT_B = '019b76da-a800-7000-8000-00000000000b' as Uuid;

const bytes = (text: string) => new TextEncoder().encode(text);

/*
 * A stand-in for SubtleCrypto: the same bytes always give the same hash and
 * different bytes never collide, which is the only property this layer uses.
 */
const hasha = async (data: Uint8Array): Promise<Sha256> => {
  let summa = 0;
  for (const byte of data) {
    summa = (summa * 31 + byte) % 0xff_ff_ff;
  }
  return sha256(summa.toString(16).padStart(6, '0').repeat(11).slice(0, 64));
};

const fil = (namn: string, innehall: string, mime = 'image/jpeg'): Importfil => ({
  namn,
  mime,
  data: bytes(innehall),
});

const rad = (namn: string, filnamn: string, verifikat?: Uuid): Importrad =>
  verifikat === undefined
    ? { namn, filnamn, orsak: 'Filnamnet säger inget verifikat.' }
    : { namn, filnamn, verifikat, beteckning: 'A50' };

describe('importeraUnderlag', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = new KonteraDatabase(`kontera-underlagsimport-${(raknare += 1)}`);
    await db.open();
  });

  it('stores the files and links them to their verifikat', async () => {
    const utfall = await importeraUnderlag(
      db,
      kontext,
      [
        fil('2025-A50-foder.pdf', 'ett', 'application/pdf'),
        fil('2025-A51-lamm.jpg', 'tva'),
      ],
      [
        rad('2025-A50-foder.pdf', 'foder.pdf', VERIFIKAT_A),
        rad('2025-A51-lamm.jpg', 'lamm.jpg', VERIFIKAT_B),
      ],
      { hasha },
    );

    expect(utfall).toMatchObject({ nya: 2, redanFanns: 0, kopplade: 2 });
    expect(utfall.avvisade).toEqual([]);

    const kopplade = await underlagForVerifikat(db, VERIFIKAT_A);
    expect(kopplade.map((underlag) => underlag.filnamn)).toEqual(['foder.pdf']);
  });

  /* Evidence is kept even when the automatic half could not place it. */
  it('imports an unplaceable file without a link', async () => {
    const utfall = await importeraUnderlag(
      db,
      kontext,
      [fil('kvitto.jpg', 'tre')],
      [rad('kvitto.jpg', 'kvitto.jpg')],
      { hasha },
    );

    expect(utfall).toMatchObject({ nya: 1, kopplade: 0 });
    expect(utfall.okopplade).toEqual([
      { namn: 'kvitto.jpg', orsak: 'Filnamnet säger inget verifikat.' },
    ]);
    expect(await okoppladeUnderlag(db)).toHaveLength(1);
  });

  /*
   * The realistic second run: three names were corrected and the whole
   * folder picked again. Nothing may be stored or logged twice.
   */
  it('is idempotent', async () => {
    const filer = [fil('2025-A50-foder.pdf', 'ett', 'application/pdf')];
    const plan = [rad('2025-A50-foder.pdf', 'foder.pdf', VERIFIKAT_A)];

    await importeraUnderlag(db, kontext, filer, plan, { hasha });
    const efterForsta = (await lasLogg(db)).length;

    const andra = await importeraUnderlag(db, kontext, filer, plan, { hasha });

    expect(andra).toMatchObject({ nya: 0, redanFanns: 1, kopplade: 0 });
    expect((await lasLogg(db)).length).toBe(efterForsta);
    expect(await underlagForVerifikat(db, VERIFIKAT_A)).toHaveLength(1);
  });

  /*
   * One receipt can cover two bookings, and the same bytes are one underlag
   * with two links rather than two copies of a picture.
   */
  it('gives one file two links when it is named for two verifikat', async () => {
    const utfall = await importeraUnderlag(
      db,
      kontext,
      [
        fil('2025-A50-foder.pdf', 'samma', 'application/pdf'),
        fil('2025-A51-foder.pdf', 'samma', 'application/pdf'),
      ],
      [
        rad('2025-A50-foder.pdf', 'foder.pdf', VERIFIKAT_A),
        rad('2025-A51-foder.pdf', 'foder.pdf', VERIFIKAT_B),
      ],
      { hasha },
    );

    expect(utfall).toMatchObject({ nya: 1, redanFanns: 1, kopplade: 2 });
    expect(await underlagForVerifikat(db, VERIFIKAT_A)).toHaveLength(1);
    expect(await underlagForVerifikat(db, VERIFIKAT_B)).toHaveLength(1);
  });

  /* A folder of ninety receipts must not be lost because one is a HEIC. */
  it('reports what it cannot archive and imports the rest', async () => {
    const utfall = await importeraUnderlag(
      db,
      kontext,
      [
        fil('2025-A50-kvitto.heic', 'fyra', 'image/heic'),
        fil('2025-A51-tom.jpg', ''),
        fil('2025-A50-foder.pdf', 'fem', 'application/pdf'),
      ],
      [
        rad('2025-A50-kvitto.heic', 'kvitto.heic', VERIFIKAT_A),
        rad('2025-A51-tom.jpg', 'tom.jpg', VERIFIKAT_B),
        rad('2025-A50-foder.pdf', 'foder.pdf', VERIFIKAT_A),
      ],
      { hasha },
    );

    expect(utfall).toMatchObject({ nya: 1, kopplade: 1 });
    expect(utfall.avvisade.map((post) => post.namn)).toEqual([
      '2025-A50-kvitto.heic',
      '2025-A51-tom.jpg',
    ]);
    expect(utfall.avvisade[0]?.orsak).toContain('image/heic');
  });
});
