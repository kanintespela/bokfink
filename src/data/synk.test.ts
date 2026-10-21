import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import { skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast } from '../domain/verifikat/verifikat';
import { franBase64, tillBase64 } from './base64';
import { lasLogg, lasTillstand } from './bokforing';
import { KonteraDatabase } from './db';
import {
  bokforUtkast,
  momslas,
  sattIngaendeBalanser,
  skrivKonto,
  skrivRakenskapsar,
  type Skrivkontext,
} from './kommandon';
import { forberedBokforing, GRUNDKONTON } from './uppstart';
import { fastKlocka } from '../domain/tid/klocka';
import { sha256, type Sha256 } from '../domain/underlag/underlag';
import { lasFil, sparaUnderlag } from './underlag';
import {
  glomServern,
  osankta,
  synka,
  type Fjarrpost,
  type Krypto,
  type Synktransport,
} from './synk';

let raknare = 0;
let klockslag = 1_788_554_000_000;

const kontext = (enhet: string): Skrivkontext => ({
  enhet,
  nu: () => '2026-09-07T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(5)),
});

const AR_2026 = '019b76da-a800-7000-8000-000000002026' as Uuid;

/**
 * A server in memory: a list of envelopes with a unique id, which is all the
 * protocol asks of one.
 */
function fejkserver() {
  const poster: Fjarrpost[] = [];
  const filer = new Map<string, Uint8Array>();
  let klocka = 0;

  const transport: Synktransport = {
    hamta: async (markor) => {
      const efter = markor === undefined ? '' : `${markor.created}|${markor.id}`;
      return poster
        .filter((post) => `${post.created}|${post.id}` > efter)
        .sort((a, b) => `${a.created}|${a.id}`.localeCompare(`${b.created}|${b.id}`));
    },
    skicka: async (nya) => {
      for (const post of nya) {
        // The unique index is what gives idempotence, and the fake has one.
        if (poster.some((redan) => redan.op_id === post.op_id)) {
          continue;
        }
        klocka += 1;
        // The server assigns both the timestamp and its own row id.
        poster.push({
          ...post,
          created: String(klocka).padStart(6, '0'),
          id: `rad${String(klocka).padStart(6, '0')}`,
        });
      }
    },
    filadresser: async () => [...filer.keys()],
    skickaFil: async (adress, chiffer) => {
      filer.set(adress, chiffer);
    },
    hamtaFil: async (adress) => filer.get(adress),
  };

  return { transport, poster, filer };
}

/**
 * Stand-in encryption: reversible, and opaque enough that a test can tell
 * whether the bookkeeping reached the server in the clear. The real one is
 * AES-GCM; what is tested here is the protocol around it.
 */
const krypto: Krypto = {
  kryptera: async (klartext) => tillBase64(new TextEncoder().encode(klartext)),
  dekryptera: async (chiffer) => new TextDecoder().decode(franBase64(chiffer)),
  // Reversible and obviously not the real thing: every byte is flipped, which
  // is enough to show that what lies on the server is not the file itself.
  krypteraFil: async (data) => data.map((byte) => byte ^ 0xff),
  dekrypteraFil: async (chiffer) => chiffer.map((byte) => byte ^ 0xff),
};

/**
 * A hash that behaves like one for the protocol's purposes: the same bytes
 * always give the same address, and different bytes never share one.
 */
const hasha = async (data: Uint8Array): Promise<Sha256> => {
  let summa = 0;
  for (const byte of data) {
    summa = (summa * 31 + byte) % 0xff_ff_ff;
  }
  return sha256(summa.toString(16).padStart(6, '0').repeat(11).slice(0, 64));
};

async function nyDb(): Promise<KonteraDatabase> {
  const db = new KonteraDatabase(`kontera-synk-${(raknare += 1)}`);
  await db.open();
  return db;
}

async function grundlagg(db: KonteraDatabase, enhet: string): Promise<void> {
  await skrivRakenskapsar(
    db,
    kontext(enhet),
    skapaRakenskapsar({
      id: AR_2026,
      start: datum('2026-01-01'),
      slut: datum('2026-12-31'),
    }),
  );
  await skrivKonto(db, kontext(enhet), skapaKonto({ nummer: '4010', namn: 'Inköp' }));
  await skrivKonto(
    db,
    kontext(enhet),
    skapaKonto({ nummer: '2013', namn: 'Eget uttag' }),
  );
}

function utkast(datumtext: string, belopp: string) {
  return skapaUtkast({
    id: uuidv7((klockslag += 1), new Uint8Array(10).fill(9)),
    datum: datum(datumtext),
    beskrivning: 'Inköp',
    konteringar: [
      { konto: kontonummer('4010'), belopp: oreFromKronor(belopp) },
      { konto: kontonummer('2013'), belopp: oreFromKronor(`-${belopp}`) },
    ],
  });
}

describe('synka', () => {
  let telefonen: KonteraDatabase;
  let datorn: KonteraDatabase;
  let server: ReturnType<typeof fejkserver>;

  beforeEach(async () => {
    telefonen = await nyDb();
    datorn = await nyDb();
    server = fejkserver();
  });

  it('carries what one device booked over to the other', async () => {
    await grundlagg(telefonen, 'telefonen');
    await bokforUtkast(
      telefonen,
      kontext('telefonen'),
      utkast('2026-02-13', '520.31'),
      verifikatserie('A'),
    );

    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });
    const resultat = await synka(datorn, server.transport, krypto, 'datorn', { hasha });

    expect(resultat.mottagna).toBe(4);
    expect(resultat.nya).toBe(4);
    expect((await lasTillstand(datorn)).verifikat.size).toBe(1);
  });

  /*
   * The server never sees bookkeeping. That is the whole reason a payload
   * exists rather than columns.
   */
  it('sends nothing the server can read', async () => {
    await grundlagg(telefonen, 'telefonen');
    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });

    const allt = JSON.stringify(server.poster);
    expect(allt).not.toContain('Inköp');
    expect(allt).not.toContain('4010');
    // And it is still the log underneath, once it is opened.
    const oppnad = await Promise.all(
      server.poster.map((post) => krypto.dekryptera(post.payload)),
    );
    expect(oppnad.join('')).toContain('konto.skapat');
  });

  it('empties the queue only for what the server took', async () => {
    await grundlagg(telefonen, 'telefonen');
    expect(await osankta(telefonen)).toBe(3);

    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });
    expect(await osankta(telefonen)).toBe(0);
  });

  /*
   * A failed send must be safe to retry, which is what the queue is for: the
   * entries stay in it, and the server's unique index turns the second
   * attempt into a no-op.
   */
  it('keeps the queue when the send fails', async () => {
    await grundlagg(telefonen, 'telefonen');
    const trasig: Synktransport = {
      hamta: async () => [],
      skicka: async () => {
        throw new Error('nätverket dog');
      },
      filadresser: async () => [],
      skickaFil: async () => undefined,
      hamtaFil: async () => undefined,
    };

    await expect(
      synka(telefonen, trasig, krypto, 'telefonen', { hasha }),
    ).rejects.toThrow();
    expect(await osankta(telefonen)).toBe(3);

    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });
    expect(await osankta(telefonen)).toBe(0);
  });

  /*
   * Moving to a new server. The queue only holds what has never been sent, so
   * a device that has synced once would log in somewhere new, send nothing
   * and call it a success - with both devices believing they were in step
   * while the new server stayed empty.
   */
  it('queues the whole log again when the server is forgotten', async () => {
    await grundlagg(telefonen, 'telefonen');
    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });
    expect(await osankta(telefonen)).toBe(0);

    await glomServern(telefonen);
    expect(await osankta(telefonen)).toBe((await lasLogg(telefonen)).length);

    // The new server ends up with everything the old one had.
    const ny = fejkserver();
    const utfall = await synka(telefonen, ny.transport, krypto, 'telefonen', { hasha });
    expect(utfall.skickade).toBe((await lasLogg(telefonen)).length);
    expect(ny.poster).toHaveLength(server.poster.length);
  });

  /*
   * What arrives from the server is not sent back. Without this the two
   * devices would trade the same entries forever.
   */
  it('does not send back what it received', async () => {
    await grundlagg(telefonen, 'telefonen');
    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });
    await synka(datorn, server.transport, krypto, 'datorn', { hasha });

    expect(await osankta(datorn)).toBe(0);
    const fore = server.poster.length;
    await synka(datorn, server.transport, krypto, 'datorn', { hasha });
    expect(server.poster).toHaveLength(fore);
  });

  it('is a no-op when nothing has happened anywhere', async () => {
    await grundlagg(telefonen, 'telefonen');
    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });

    expect(
      await synka(telefonen, server.transport, krypto, 'telefonen', { hasha }),
    ).toEqual({
      skickade: 0,
      mottagna: 0,
      nya: 0,
      filerSkickade: 0,
      filerMottagna: 0,
      filerAvvisade: 0,
    });
  });

  /*
   * The receipts themselves, which the log does not carry. A device that
   * knew about an underlag without being able to show it would have half an
   * archive, and half an archive is what bokföringslagen 7 kap. does not
   * accept.
   */
  it('carries the files an underlag points at', async () => {
    await grundlagg(telefonen, 'telefonen');
    const data = new TextEncoder().encode('ett kvitto');
    await sparaUnderlag(telefonen, kontext('telefonen'), {
      sha256: await hasha(data),
      mime: 'image/jpeg',
      filnamn: 'kvitto.jpg',
      data,
    });

    const skickat = await synka(telefonen, server.transport, krypto, 'telefonen', {
      hasha,
    });
    expect(skickat.filerSkickade).toBe(1);
    // What lies on the server is not the file: the bytes are encrypted.
    expect([...(server.filer.get(await hasha(data)) ?? [])]).not.toEqual([...data]);

    const mottaget = await synka(datorn, server.transport, krypto, 'datorn', { hasha });
    expect(mottaget.filerMottagna).toBe(1);

    const fil = await lasFil(datorn, await hasha(data));
    expect(fil?.mime).toBe('image/jpeg');
    expect(new TextDecoder().decode(fil?.data)).toBe('ett kvitto');
  });

  /* Content addressing makes a second round free rather than a repeat. */
  it('sends each file once', async () => {
    await grundlagg(telefonen, 'telefonen');
    const data = new TextEncoder().encode('samma kvitto');
    await sparaUnderlag(telefonen, kontext('telefonen'), {
      sha256: await hasha(data),
      mime: 'application/pdf',
      filnamn: 'kvitto.pdf',
      data,
    });

    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });
    const igen = await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });

    expect(igen.filerSkickade).toBe(0);
    expect(server.filer.size).toBe(1);
  });

  /*
   * The address is a promise about the content. A file that does not keep it
   * is refused rather than stored, and counted rather than thrown - one bad
   * file must not stop the rest of the sync.
   */
  it('refuses a file that does not match its address', async () => {
    await grundlagg(telefonen, 'telefonen');
    const data = new TextEncoder().encode('rätt kvitto');
    const adress = await hasha(data);
    await sparaUnderlag(telefonen, kontext('telefonen'), {
      sha256: adress,
      mime: 'image/jpeg',
      filnamn: 'kvitto.jpg',
      data,
    });
    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });

    // Someone, or something, changed the bytes on the server.
    server.filer.set(
      adress,
      await krypto.krypteraFil(new TextEncoder().encode('något annat')),
    );

    const utfall = await synka(datorn, server.transport, krypto, 'datorn', { hasha });

    expect(utfall.filerAvvisade).toBe(1);
    expect(utfall.filerMottagna).toBe(0);
    expect(await lasFil(datorn, adress)).toBeUndefined();
  });

  /*
   * The case the whole design is for: both devices book while offline, in
   * their own series, and neither loses anything when they meet.
   */
  it('merges two devices that booked while apart', async () => {
    await grundlagg(telefonen, 'telefonen');
    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });
    await synka(datorn, server.transport, krypto, 'datorn', { hasha });

    await bokforUtkast(
      telefonen,
      kontext('telefonen'),
      utkast('2026-02-13', '520.31'),
      verifikatserie('A'),
    );
    await bokforUtkast(
      datorn,
      kontext('datorn'),
      utkast('2026-03-01', '249.00'),
      verifikatserie('B'),
    );

    // Each sends its own, then takes the other's.
    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });
    await synka(datorn, server.transport, krypto, 'datorn', { hasha });
    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });

    for (const db of [telefonen, datorn]) {
      const tillstand = await lasTillstand(db);
      expect(tillstand.verifikat.size).toBe(2);
      const serier = [...tillstand.verifikat.values()].map((post) => post.serie).sort();
      expect(serier).toEqual(['A', 'B']);
    }

    // And both hold the same log, entry for entry.
    expect((await lasLogg(telefonen)).map((post) => post.id)).toEqual(
      (await lasLogg(datorn)).map((post) => post.id),
    );
  });

  it('picks up only what is new since the last time', async () => {
    await grundlagg(telefonen, 'telefonen');
    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });
    await synka(datorn, server.transport, krypto, 'datorn', { hasha });

    await skrivKonto(
      telefonen,
      kontext('telefonen'),
      skapaKonto({ nummer: '1930', namn: 'Företagskonto' }),
    );
    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });

    expect(
      await synka(datorn, server.transport, krypto, 'datorn', { hasha }),
    ).toMatchObject({
      mottagna: 1,
      nya: 1,
    });
  });
});

/*
 * A new device creates a year, a handful of accounts and seven templates the
 * moment it first starts, before anyone has had the chance to log it in to
 * the sync. Sent as they were, those met the books they were joining: every
 * template twice, and starter accounts and an empty year arriving after the
 * real ones - with names, SRU codes and opening balances at stake.
 */
describe('a new device joining books that already exist', () => {
  const IDAG = fastKlocka(datum('2026-09-13'));

  let telefonen: KonteraDatabase;
  let nya: KonteraDatabase;
  let server: ReturnType<typeof fejkserver>;

  beforeEach(async () => {
    telefonen = await nyDb();
    nya = await nyDb();
    server = fejkserver();

    await forberedBokforing(telefonen, kontext('telefonen'), IDAG);
    const [ar] = [...(await lasTillstand(telefonen)).rakenskapsar.values()];
    await sattIngaendeBalanser(telefonen, kontext('telefonen'), ar!.id, [
      { konto: kontonummer('1930'), belopp: oreFromKronor('1000') },
      { konto: kontonummer('2013'), belopp: oreFromKronor('-1000') },
    ]);
    await momslas(telefonen, kontext('telefonen'), ar!.id, datum('2026-06-30'));
    await skrivKonto(
      telefonen,
      kontext('telefonen'),
      skapaKonto({ nummer: '3010', namn: 'Försäljning livdjur', sru: ['7410'] }),
      true,
    );
    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });
  });

  it('takes the books it joins instead of adding its own starter set', async () => {
    await forberedBokforing(nya, kontext('nya'), IDAG);
    await synka(nya, server.transport, krypto, 'nya', { hasha });
    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });

    for (const db of [nya, telefonen]) {
      const tillstand = await lasTillstand(db);
      // The starter accounts once, and the one the phone added.
      expect(tillstand.konton.size).toBe(GRUNDKONTON.length + 1);
      expect(tillstand.rakenskapsar.size).toBe(1);
      const [ar] = [...tillstand.rakenskapsar.values()];
      expect(ar?.ingaendeBalanser).toHaveLength(2);
      expect(ar?.momslastTom).toBe('2026-06-30');
      expect(tillstand.konton.get(kontonummer('3010'))).toMatchObject({
        namn: 'Försäljning livdjur',
        sru: ['7410'],
      });
    }
    expect((await lasLogg(nya)).map((post) => post.id)).toEqual(
      (await lasLogg(telefonen)).map((post) => post.id),
    );
    expect(await osankta(nya)).toBe(0);
  });

  /*
   * Only a device nobody has used. One that has booked something has work of
   * its own, and that is joined the way two devices always are.
   */
  it('keeps and sends what was done on the device before it joined', async () => {
    await forberedBokforing(nya, kontext('nya'), IDAG);
    await skrivKonto(
      nya,
      kontext('nya'),
      skapaKonto({ nummer: '6110', namn: 'Kontorsmateriel' }),
    );
    await synka(nya, server.transport, krypto, 'nya', { hasha });

    expect((await lasTillstand(nya)).konton.has(kontonummer('6110'))).toBe(true);
    await synka(telefonen, server.transport, krypto, 'telefonen', { hasha });
    expect((await lasTillstand(telefonen)).konton.has(kontonummer('6110'))).toBe(true);
  });

  it('keeps its starter set when it is the first device on the server', async () => {
    const tom = fejkserver();
    await forberedBokforing(nya, kontext('nya'), IDAG);
    await synka(nya, tom.transport, krypto, 'nya', { hasha });

    expect((await lasTillstand(nya)).konton.size).toBe(GRUNDKONTON.length);
    expect(tom.poster.length).toBeGreaterThan(0);
  });

  it('keeps its starter set when the server cannot be read', async () => {
    const felNyckel: Krypto = {
      ...krypto,
      dekryptera: async () => {
        throw new Error('Lösenfrasen stämmer inte');
      },
    };
    await forberedBokforing(nya, kontext('nya'), IDAG);

    await expect(
      synka(nya, server.transport, felNyckel, 'nya', { hasha }),
    ).rejects.toThrow('Lösenfrasen stämmer inte');
    expect((await lasTillstand(nya)).konton.size).toBe(GRUNDKONTON.length);
  });
});
