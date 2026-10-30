import 'fake-indexeddb/auto';

import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import { skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast } from '../domain/verifikat/verifikat';
import {
  exportera,
  exporteraSomText,
  importera,
  AnnanBokError,
  las,
  OlasbarSakerhetskopiaError,
  SkadadFilError,
} from './backup';
import { lasLogg, lasTillstand, skyddaBokfordaVerifikat } from './bokforing';
import { hashaFil } from '../platform/hash';
import { dekryptera, harledNyckel, kryptera, nyttSalt } from '../platform/krypto';
import { tillBase64 } from './base64';
import { arKrypterad, laspaket, paketera } from './kryptokopia';
import { lasFil, sparaUnderlag } from './underlag';
import {
  BOK_ID_NYCKEL,
  BOK_PROFIL_NYCKEL,
  lasBokId,
  lasBokprofil,
  URSPRUNGLIG_BOK,
} from './bokidentitet';
import { KonteraDatabase } from './db';
import { forberedBokforing, GRUNDKONTON } from './uppstart';
import { fastKlocka } from '../domain/tid/klocka';
import {
  bokforUtkast,
  skrivKonto,
  skrivRakenskapsar,
  sparaUtkast,
  type Skrivkontext,
} from './kommandon';

let raknare = 0;
let klockslag = 1_788_554_000_000;

const nyDb = async () => {
  const db = new KonteraDatabase(`kontera-backup-${(raknare += 1)}`);
  skyddaBokfordaVerifikat(db);
  await db.open();
  return db;
};

const kontext: Skrivkontext = {
  enhet: 'enhet-a',
  nu: () => '2026-09-05T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(9)),
};

const AR_2026 = '019b76da-a800-7000-8000-000000002026' as Uuid;

const utkast = (datumtext: string) =>
  skapaUtkast({
    id: kontext.nyttId!(),
    datum: datum(datumtext),
    beskrivning: 'Inköp av kraftfoder',
    konteringar: [
      { konto: kontonummer('4010'), belopp: oreFromKronor('416.25') },
      { konto: kontonummer('2013'), belopp: oreFromKronor('-416.25') },
    ],
  });

async function fyll(db: KonteraDatabase): Promise<void> {
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
  await bokforUtkast(db, kontext, utkast('2026-01-09'), verifikatserie('A'));
  await bokforUtkast(db, kontext, utkast('2026-02-13'), verifikatserie('A'));
  await sparaUtkast(db, kontext, utkast('2026-03-01'));
  await db.setMeta('momsperiod', 'kvartal');
}

describe('backup av underlag', () => {
  let db: KonteraDatabase;

  const bytes = new TextEncoder().encode('kvitto-bytes');

  beforeEach(async () => {
    db = await nyDb();
    await sparaUnderlag(db, kontext, {
      sha256: await hashaFil(bytes),
      mime: 'image/jpeg',
      filnamn: 'kvitto.jpg',
      data: bytes,
    });
  });

  /*
   * The files are the one thing the log cannot rebuild. A backup that left
   * them out would restore bookkeeping whose evidence had vanished, which is
   * the failure nobody notices until Skatteverket asks.
   */
  it('carries the files and restores their bytes', async () => {
    const kopia = las(await exporteraSomText(db));
    expect(kopia.filer).toHaveLength(1);

    const ny = await nyDb();
    const resultat = await importera(ny, kopia, { hasha: hashaFil });

    expect(resultat.nyaFiler).toBe(1);
    expect((await lasFil(ny, kopia.filer[0]!.sha256))?.data).toEqual(bytes);
    expect(await lasTillstand(ny)).toEqual(await lasTillstand(db));
    ny.close();
  });

  it('restores the files only once', async () => {
    const kopia = las(await exporteraSomText(db));
    const ny = await nyDb();

    expect((await importera(ny, kopia, { hasha: hashaFil })).nyaFiler).toBe(1);
    expect((await importera(ny, kopia, { hasha: hashaFil })).nyaFiler).toBe(0);
    ny.close();
  });

  /*
   * The checksum is the whole reason the file is addressed by its hash. A
   * restore that quietly accepted a receipt whose bytes had rotted would be
   * worse than one that refuses to finish.
   */
  it('refuses a file whose bytes do not match its checksum', async () => {
    const kopia = las(await exporteraSomText(db));
    const skadad = {
      ...kopia,
      filer: [
        { ...kopia.filer[0]!, data: tillBase64(new TextEncoder().encode('nagot')) },
      ],
    };

    const ny = await nyDb();
    await expect(importera(ny, skadad, { hasha: hashaFil })).rejects.toBeInstanceOf(
      SkadadFilError,
    );
    ny.close();
  });

  it('still reads a backup written before there were files', async () => {
    const kopia: Record<string, unknown> = { ...(await exportera(db)) };
    delete kopia.filer;
    const gammal = JSON.stringify({ ...kopia, formatversion: 1 });

    expect(las(gammal).filer).toEqual([]);
  });
});

describe('backup', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = await nyDb();
    await fyll(db);
  });

  /*
   * The acceptance criterion for the whole safety valve: export followed by
   * import into an empty database gives back the same books. If this ever
   * fails, leaving Kontera costs data, which is the one thing the project
   * promises it never will.
   */
  it('restores identical books into an empty database', async () => {
    const kopia = las(await exporteraSomText(db));
    const ny = await nyDb();
    await importera(ny, kopia);

    expect(await lasTillstand(ny)).toEqual(await lasTillstand(db));
    expect(await lasLogg(ny)).toEqual(await lasLogg(db));
    ny.close();
  });

  it('carries the log, the metadata and the files, but no view', async () => {
    const kopia = await exportera(db);
    expect(Object.keys(kopia).sort()).toEqual([
      'filer',
      'format',
      'formatversion',
      'handelser',
      'meta',
      'schemaversion',
      'skapad',
    ]);
    expect(kopia.handelser).toHaveLength(6);
  });

  it('is unchanged by restoring twice', async () => {
    const kopia = las(await exporteraSomText(db));
    const ny = await nyDb();

    const forsta = await importera(ny, kopia);
    const andra = await importera(ny, kopia);

    expect(forsta.nyaHandelser).toBe(6);
    expect(andra.nyaHandelser).toBe(0);
    expect(await lasTillstand(ny)).toEqual(await lasTillstand(db));
    ny.close();
  });

  it('keeps the restoring device its own identity', async () => {
    // A backup from the phone must not turn the computer into the phone, or
    // both would hand out numbers in the same series.
    await db.setMeta('deviceId', 'telefonen');
    const kopia = las(await exporteraSomText(db));

    const ny = await nyDb();
    await ny.setMeta('deviceId', 'datorn');
    await importera(ny, kopia);

    expect(await ny.getMeta('deviceId')).toBe('datorn');
    expect(await ny.getMeta('momsperiod')).toBe('kvartal');
    ny.close();
  });

  it('merges a backup into a database that already has entries', async () => {
    const kopia = las(await exporteraSomText(db));
    const ny = await nyDb();
    await skrivRakenskapsar(
      ny,
      kontext,
      skapaRakenskapsar({
        id: AR_2026,
        start: datum('2026-01-01'),
        slut: datum('2026-12-31'),
      }),
    );

    await importera(ny, kopia);
    expect((await lasTillstand(ny)).verifikat.size).toBe(2);
    ny.close();
  });

  it('survives a round trip through text unchanged', async () => {
    const text = await exporteraSomText(db);
    expect(las(text)).toEqual(await exportera(db, () => las(text).skapad));
  });

  it('refuses a file that is not a Bokfink backup', async () => {
    for (const trasig of ['', 'inte json', '{}', '[]', '{"format":"nagot-annat"}']) {
      expect(() => las(trasig)).toThrow(OlasbarSakerhetskopiaError);
    }
  });

  it('refuses a backup from a newer database than it understands', async () => {
    const kopia = { ...(await exportera(db)), schemaversion: 99 };
    expect(() => las(JSON.stringify(kopia))).toThrow(/Uppdatera appen/);
  });

  it('restores any ledger it can build', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom('2026-01-09', '2026-02-13', '2026-03-01'), {
          minLength: 1,
          maxLength: 6,
        }),
        async (datumen) => {
          const kalla = await nyDb();
          await skrivRakenskapsar(
            kalla,
            kontext,
            skapaRakenskapsar({
              id: AR_2026,
              start: datum('2026-01-01'),
              slut: datum('2026-12-31'),
            }),
          );
          for (const d of datumen) {
            await bokforUtkast(kalla, kontext, utkast(d), verifikatserie('A'));
          }

          const mal = await nyDb();
          await importera(mal, las(await exporteraSomText(kalla)));

          expect(await lasTillstand(mal)).toEqual(await lasTillstand(kalla));
          kalla.close();
          mal.close();
        },
      ),
      { numRuns: 12 },
    );
  });
});

describe('krypterad återställning på en tom enhet', () => {
  /*
   * Etapp 5's acceptance criterion, chained end to end: a device that has
   * booked something takes an encrypted backup, and a second device - one
   * that has never seen this data - derives the key from the passphrase
   * alone, decrypts, and rebuilds the ledger and its files. This is the test
   * that stands behind the promise that a lost or wiped phone costs nothing.
   */
  it('restores the ledger and its files onto an empty database on another device', async () => {
    const db = await nyDb();
    await fyll(db);

    const bytes = new TextEncoder().encode('kvitto-bytes');
    await sparaUnderlag(db, kontext, {
      sha256: await hashaFil(bytes),
      mime: 'image/jpeg',
      filnamn: 'kvitto.jpg',
      data: bytes,
    });

    const losenfras = 'en ganska lång lösenfras';
    const salt = nyttSalt();
    const nyckel = await harledNyckel(losenfras, salt, 1000);
    const { iv, chiffer } = await kryptera(
      nyckel,
      new TextEncoder().encode(await exporteraSomText(db)),
    );
    const fil = paketera({
      salt,
      iterationer: 1000,
      iv,
      chiffer,
      skapad: '2026-09-07T08:00:00.000Z',
    });

    // The envelope says what it is; the bookkeeping inside must not.
    expect(arKrypterad(JSON.parse(fil))).toBe(true);
    expect(fil).not.toContain('Inköp av kraftfoder');
    expect(fil).not.toContain('4010');

    // The second device has only the file and the passphrase - no shared
    // state, no key left over from the first device.
    const paket = laspaket(fil);
    const aterNyckel = await harledNyckel(losenfras, paket.salt, paket.iterationer);
    const klartext = new TextDecoder().decode(
      await dekryptera(aterNyckel, paket.iv, paket.chiffer),
    );

    const ny = await nyDb();
    const resultat = await importera(ny, las(klartext), { hasha: hashaFil });

    expect(resultat.nyaFiler).toBe(1);
    expect(await lasTillstand(ny)).toEqual(await lasTillstand(db));
    expect(await lasLogg(ny)).toEqual(await lasLogg(db));
    db.close();
    ny.close();
  });

  it('refuses to derive a usable key from the wrong passphrase', async () => {
    const db = await nyDb();
    await fyll(db);

    const salt = nyttSalt();
    const nyckel = await harledNyckel('rätt lösenfras', salt, 1000);
    const { iv, chiffer } = await kryptera(
      nyckel,
      new TextEncoder().encode(await exporteraSomText(db)),
    );
    const paket = laspaket(
      paketera({
        salt,
        iterationer: 1000,
        iv,
        chiffer,
        skapad: '2026-09-07T08:00:00.000Z',
      }),
    );

    const felNyckel = await harledNyckel('fel lösenfras', paket.salt, paket.iterationer);
    await expect(dekryptera(felNyckel, paket.iv, paket.chiffer)).rejects.toThrow();
    db.close();
  });
});

/*
 * Restoring onto a new device is the normal case for a backup - the phone
 * was lost - and a new device has already made itself ready to book by the
 * time anyone gets to the restore screen. Folded together, that starter set
 * and the backup gave every template twice.
 */
describe('restoring onto a new device', () => {
  const kontext = (enhet: string): Skrivkontext => ({
    enhet,
    nu: () => '2026-09-13T08:00:00.000Z',
    nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(4)),
  });
  const IDAG = fastKlocka(datum('2026-09-13'));

  it('takes the books in the backup instead of adding them to its starter set', async () => {
    const gamla = await nyDb();
    await forberedBokforing(gamla, kontext('gamla'), IDAG);
    const kopia = await exportera(gamla, () => '2026-09-13T09:00:00.000Z');

    const nya = await nyDb();
    await forberedBokforing(nya, kontext('nya'), IDAG);
    await importera(nya, kopia);

    const tillstand = await lasTillstand(nya);
    expect(tillstand.konton.size).toBe(GRUNDKONTON.length);
    expect(tillstand.rakenskapsar.size).toBe(1);
    expect((await lasLogg(nya)).map((post) => post.id)).toEqual(
      (await lasLogg(gamla)).map((post) => post.id),
    );
  });

  it('keeps what was done on the device before the restore', async () => {
    const gamla = await nyDb();
    await forberedBokforing(gamla, kontext('gamla'), IDAG);
    const kopia = await exportera(gamla, () => '2026-09-13T09:00:00.000Z');

    const nya = await nyDb();
    await forberedBokforing(nya, kontext('nya'), IDAG);
    await skrivKonto(
      nya,
      kontext('nya'),
      skapaKonto({ nummer: '6110', namn: 'Kontorsmateriel' }),
    );
    await importera(nya, kopia);

    expect((await lasTillstand(nya)).konton.has(kontonummer('6110'))).toBe(true);
  });
});

describe('en säkerhetskopia från en annan bok', () => {
  let firman: KonteraDatabase;

  beforeEach(async () => {
    firman = await nyDb();
    await fyll(firman);
  });

  it('is refused by a book that already holds entries, which is left untouched', async () => {
    const kopia = las(await exporteraSomText(firman));
    const foreningen = await nyDb();
    await foreningen.setMeta(BOK_ID_NYCKEL, 'foreningen');
    await skrivKonto(
      foreningen,
      kontext,
      skapaKonto({ nummer: '3890', namn: 'Medlemsavgifter' }),
    );
    const fore = await lasLogg(foreningen);

    await expect(importera(foreningen, kopia)).rejects.toBeInstanceOf(AnnanBokError);
    expect(await lasLogg(foreningen)).toEqual(fore);
    expect(await lasBokId(foreningen)).toBe('foreningen');
    expect(await foreningen.getMeta('momsperiod')).toBeUndefined();
    foreningen.close();
  });

  it('is taken in whole by an empty database, which becomes that book', async () => {
    await firman.setMeta(BOK_ID_NYCKEL, 'foreningen');
    const kopia = las(await exporteraSomText(firman));
    const nyEnhet = await nyDb();
    await nyEnhet.setMeta(BOK_ID_NYCKEL, 'ny-bok');

    await importera(nyEnhet, kopia);
    expect(await lasBokId(nyEnhet)).toBe('foreningen');
    expect(await lasLogg(nyEnhet)).toEqual(await lasLogg(firman));
    nyEnhet.close();
  });

  it('is taken by a database holding nothing but its starter set', async () => {
    const kopia = las(await exporteraSomText(firman));
    const nyBok = await nyDb();
    await nyBok.setMeta(BOK_ID_NYCKEL, 'ny-bok');
    await forberedBokforing(nyBok, kontext, fastKlocka(datum('2026-09-13')));

    await importera(nyBok, kopia);
    expect(await lasBokId(nyBok)).toBe(URSPRUNGLIG_BOK);
    nyBok.close();
  });

  it('gives an empty association book the profile of the firm it takes the identity of', async () => {
    // A copy from before profiles existed records none: it is a firm's.
    const kopia = las(await exporteraSomText(firman));
    expect(kopia.meta.some((rad) => rad.key === BOK_PROFIL_NYCKEL)).toBe(false);
    const foreningen = await nyDb();
    await foreningen.setMeta(BOK_ID_NYCKEL, 'foreningen');
    await foreningen.setMeta(BOK_PROFIL_NYCKEL, 'forening');

    await importera(foreningen, kopia);
    expect(await lasBokprofil(foreningen)).toBe('enskild_firma');
    foreningen.close();
  });

  it("carries an association's profile to the device it is restored onto", async () => {
    await firman.setMeta(BOK_ID_NYCKEL, 'foreningen');
    await firman.setMeta(BOK_PROFIL_NYCKEL, 'forening');
    const kopia = las(await exporteraSomText(firman));
    const nyEnhet = await nyDb();
    await nyEnhet.setMeta(BOK_ID_NYCKEL, 'ny-bok');
    await nyEnhet.setMeta(BOK_PROFIL_NYCKEL, 'enskild_firma');

    await importera(nyEnhet, kopia);
    expect(await lasBokprofil(nyEnhet)).toBe('forening');
    nyEnhet.close();
  });

  it('refuses a copy whose profile this version does not know', async () => {
    await firman.setMeta(BOK_ID_NYCKEL, 'annan');
    await firman.setMeta(BOK_PROFIL_NYCKEL, 'stiftelse');
    const kopia = las(await exporteraSomText(firman));
    const nyEnhet = await nyDb();
    await nyEnhet.setMeta(BOK_ID_NYCKEL, 'ny-bok');

    await expect(importera(nyEnhet, kopia)).rejects.toThrow(/inte känner till/);
    nyEnhet.close();
  });

  it('is not what a copy of the same book is, whichever device took it', async () => {
    // The phone and the computer have exchanged backups of the original book
    // since before books had identities; neither copy may stop doing so.
    const kopia = las(await exporteraSomText(firman));
    const datorn = await nyDb();
    await skrivKonto(
      datorn,
      kontext,
      skapaKonto({ nummer: '6110', namn: 'Kontorsmateriel' }),
    );

    await expect(importera(datorn, kopia)).resolves.toBeDefined();
    datorn.close();
  });
});
