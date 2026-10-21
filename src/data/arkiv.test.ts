import 'fake-indexeddb/auto';

import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import { skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast } from '../domain/verifikat/verifikat';
import { lasZip } from '../domain/arkiv/zipTestReader';
import { hashaFil } from '../platform/hash';
import { byggArkivpaket, SkadatUnderlagIArkivError } from './arkiv';
import { lasTillstand, skyddaBokfordaVerifikat } from './bokforing';
import { KonteraDatabase } from './db';
import {
  bokforUtkast,
  skrivKonto,
  skrivRakenskapsar,
  type Skrivkontext,
} from './kommandon';
import { FIL_TABLE } from './schema';
import { kopplaUnderlag, sparaUnderlag } from './underlag';

let raknare = 0;
let klockslag = 1_788_554_000_000;

const nyDb = async () => {
  const db = new KonteraDatabase(`kontera-arkiv-${(raknare += 1)}`);
  skyddaBokfordaVerifikat(db);
  await db.open();
  return db;
};

const kontext: Skrivkontext = {
  enhet: 'enhet-a',
  nu: () => '2026-09-08T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(9)),
};

const AR_2026 = '019b76da-a800-7000-8000-000000002026' as Uuid;
const SKAPAD = datum('2026-09-08');

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
  await skrivKonto(db, kontext, skapaKonto({ nummer: '4010', namn: 'Inköp av foder' }));
  await skrivKonto(db, kontext, skapaKonto({ nummer: '2013', namn: 'Egna pengar' }));
  await bokforUtkast(
    db,
    kontext,
    skapaUtkast({
      id: kontext.nyttId!(),
      datum: datum('2026-01-09'),
      beskrivning: 'Inköp av kraftfoder',
      konteringar: [
        { konto: kontonummer('4010'), belopp: oreFromKronor('416.25') },
        { konto: kontonummer('2013'), belopp: oreFromKronor('-416.25') },
      ],
    }),
    verifikatserie('A'),
  );
}

describe('byggArkivpaket', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = await nyDb();
    await fyll(db);
  });

  it('packages the SIE file, a PDF, a checksum list and a read-me', async () => {
    const zip = await byggArkivpaket(db, AR_2026, SKAPAD, { hasha: hashaFil });
    const poster = lasZip(zip);
    const namn = poster.map((post) => post.namn);

    expect(namn).toContain('kontera-2026.se');
    expect(namn).toContain('verifikationslista.pdf');
    expect(namn).toContain('checksummor.txt');
    expect(namn).toContain('LASMIG.txt');
  });

  it('writes a SIE file that starts the way SIE files do', async () => {
    const poster = lasZip(await byggArkivpaket(db, AR_2026, SKAPAD, { hasha: hashaFil }));
    const sie = poster.find((post) => post.namn === 'kontera-2026.se')!;
    expect(new TextDecoder('latin1').decode(sie.data.slice(0, 12))).toContain('#FLAGGA');
  });

  it('writes a PDF that opens as a PDF', async () => {
    const poster = lasZip(await byggArkivpaket(db, AR_2026, SKAPAD, { hasha: hashaFil }));
    const pdf = poster.find((post) => post.namn === 'verifikationslista.pdf')!;
    const inlast = await PDFDocument.load(pdf.data);
    expect(inlast.getPageCount()).toBeGreaterThan(0);
  });

  /*
   * The checksum list is the archive's own proof of integrity seven years
   * from now, so it has to actually match the bytes sitting next to it - not
   * just exist.
   */
  it('writes checksums that verify every other file in the archive', async () => {
    const poster = lasZip(await byggArkivpaket(db, AR_2026, SKAPAD, { hasha: hashaFil }));
    const checksummor = new TextDecoder()
      .decode(poster.find((post) => post.namn === 'checksummor.txt')!.data)
      .trim()
      .split('\n');

    for (const post of poster) {
      if (post.namn === 'checksummor.txt') continue;
      const rad = checksummor.find((r) => r.endsWith(`  ${post.namn}`));
      expect(rad, `saknar en checksumrad för ${post.namn}`).toBeDefined();
      const [hash] = rad!.split('  ');
      expect(hash).toBe(await hashaFil(post.data));
    }
  });

  it('includes an underlag attached to a verifikat that year, named by its hash', async () => {
    const bytes = new TextEncoder().encode('kvitto-bytes');
    const sha256 = await hashaFil(bytes);
    const underlag = await sparaUnderlag(db, kontext, {
      sha256,
      mime: 'image/jpeg',
      filnamn: 'kvitto.jpg',
      data: bytes,
    });
    const [verifikatId] = [...(await lasTillstand(db)).verifikat.keys()];
    await kopplaUnderlag(db, kontext, underlag.underlag.id, verifikatId!);

    const poster = lasZip(await byggArkivpaket(db, AR_2026, SKAPAD, { hasha: hashaFil }));
    const fil = poster.find((post) => post.namn === `underlag/${sha256}.jpg`);
    expect(fil?.data).toEqual(bytes);
  });

  it('leaves out an underlag that was never attached to a verifikat', async () => {
    const bytes = new TextEncoder().encode('kvitto-bytes');
    await sparaUnderlag(db, kontext, {
      sha256: await hashaFil(bytes),
      mime: 'image/jpeg',
      filnamn: 'kvitto.jpg',
      data: bytes,
    });

    const poster = lasZip(await byggArkivpaket(db, AR_2026, SKAPAD, { hasha: hashaFil }));
    expect(poster.some((post) => post.namn.startsWith('underlag/'))).toBe(false);
  });

  it('refuses to archive an underlag whose bytes no longer match its checksum', async () => {
    const bytes = new TextEncoder().encode('kvitto-bytes');
    const underlag = await sparaUnderlag(db, kontext, {
      sha256: await hashaFil(bytes),
      mime: 'image/jpeg',
      filnamn: 'kvitto.jpg',
      data: bytes,
    });
    const [verifikatId] = [...(await lasTillstand(db)).verifikat.keys()];
    await kopplaUnderlag(db, kontext, underlag.underlag.id, verifikatId!);

    // Corrupt the stored bytes directly, as bit-rot would.
    await db.table(FIL_TABLE).update(underlag.underlag.sha256, {
      data: new TextEncoder().encode('andrade-bytes'),
    });

    await expect(
      byggArkivpaket(db, AR_2026, SKAPAD, { hasha: hashaFil }),
    ).rejects.toBeInstanceOf(SkadatUnderlagIArkivError);
  });

  it('refuses an unknown fiscal year', async () => {
    await expect(
      byggArkivpaket(db, uuidv7(1, new Uint8Array(10)), SKAPAD, { hasha: hashaFil }),
    ).rejects.toThrow(/räkenskapsår/);
  });
});
