import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { skapaKonto } from '../domain/konto/konto';
import { skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { lasLogg, lasTillstand } from '../data/bokforing';
import { KonteraDatabase } from '../data/db';
import { bokforUtkast, skrivKonto, skrivRakenskapsar } from '../data/kommandon';
import { synka, type Fjarrpost, type Krypto, type Synktransport } from '../data/synk';
import { lasFil, okoppladeUnderlag, sparaUnderlag } from '../data/underlag';
import { hashaFil } from '../platform/hash';
import { synkkrypto } from '../platform/synkkrypto';
import { korAgent, tolkaKommando, type Agentberoenden } from './agent';

let raknare = 0;
let klockslag = 1_789_000_000_000;
const nyttId = () => uuidv7((klockslag += 1), new Uint8Array(10).fill(3));

const kontext = (enhet: string) => ({
  enhet,
  nu: () => '2026-09-12T18:00:00.000Z',
  nyttId,
});

/** The re-encoded picture, recognisable by its bytes. */
const KODAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/** A server in memory with the unique indexes the real one has. */
function fejkserver(): Synktransport & { hamtadeFiler: number } {
  const poster: Fjarrpost[] = [];
  const filer = new Map<string, Uint8Array>();
  const server = {
    hamtadeFiler: 0,
    hamta: async (markor: { created: string; id: string } | undefined) => {
      const efter = markor === undefined ? '' : `${markor.created}|${markor.id}`;
      return poster.filter((post) => `${post.created}|${post.id}` > efter);
    },
    skicka: async (nya: readonly Fjarrpost[]) => {
      for (const post of nya) {
        if (!poster.some((redan) => redan.op_id === post.op_id)) {
          const lopnummer = String(poster.length + 1).padStart(6, '0');
          poster.push({ ...post, created: lopnummer, id: `rad${lopnummer}` });
        }
      }
    },
    filadresser: async () => [...filer.keys()],
    skickaFil: async (adress: string, chiffer: Uint8Array) => {
      filer.set(adress, chiffer);
    },
    hamtaFil: async (adress: string) => {
      server.hamtadeFiler += 1;
      return filer.get(adress);
    },
  };
  return server;
}

describe('the receipt assistant’s device', () => {
  let server: ReturnType<typeof fejkserver>;
  let krypto: Krypto;
  let telefonen: KonteraDatabase;
  let filer: Map<string, string>;

  const nyDb = async (namn: string) => {
    const db = new KonteraDatabase(`kontera-agent-${namn}-${(raknare += 1)}`);
    await db.open();
    return db;
  };

  const beroenden = (): Agentberoenden => ({
    transport: server,
    krypto,
    enhet: 'claude-pi',
    nu: () => '2026-09-12T18:05:00.000Z',
    idag: () => datum('2026-09-12'),
    nyttId,
    hasha: hashaFil,
    lasFil: async () => KODAD,
    lasText: async (sokvag) => {
      const text = filer.get(sokvag);
      if (text === undefined) {
        throw new Error(`ingen fil ${sokvag}`);
      }
      return text;
    },
    kodaBild: async () => KODAD,
  });

  const kor = async (argv: string[]) =>
    korAgent(await nyDb('pi'), tolkaKommando(argv), beroenden());

  beforeEach(async () => {
    server = fejkserver();
    krypto = await synkkrypto('korrekt häst batteri', 1000);
    filer = new Map([
      [
        '/tmp/forslag.json',
        JSON.stringify({
          datum: '2026-09-04',
          beskrivning: 'Foder, Lantmännen',
          konteringar: [
            { konto: '4010', belopp: '400,00' },
            { konto: '2640', belopp: '100,00' },
            { konto: '2013', belopp: '-500,00' },
          ],
          underlag: ['/uploads/photo.jpeg'],
        }),
      ],
    ]);

    // The phone has books and has synced them.
    telefonen = await nyDb('telefonen');
    await skrivRakenskapsar(
      telefonen,
      kontext('telefonen'),
      skapaRakenskapsar({
        id: '01990000-0000-7000-8000-000000002026' as Uuid,
        start: datum('2026-01-01'),
        slut: datum('2026-12-31'),
      }),
    );
    for (const [nummer, namn] of [
      ['4010', 'Inköp av material och varor'],
      ['2640', 'Ingående moms'],
      ['2013', 'Eget uttag'],
    ] as const) {
      await skrivKonto(telefonen, kontext('telefonen'), skapaKonto({ nummer, namn }));
    }
    await synka(telefonen, server, krypto, 'telefonen', { hasha: hashaFil });
  });

  /*
   * The whole round: a suggestion on the Pi becomes a draft on the phone,
   * receipt attached, and nothing is booked until the phone books it.
   */
  it('sends a draft with its receipt that the phone can book', async () => {
    const svar = await kor(['utkast', '/tmp/forslag.json']);
    expect(svar).toContain('Utkastet är skickat');
    expect(svar).toContain('2026-09-04-foder-lantmannen.jpg');

    await synka(telefonen, server, krypto, 'telefonen', { hasha: hashaFil });
    const tillstand = await lasTillstand(telefonen);

    expect(tillstand.verifikat.size).toBe(0);
    const [utkast] = [...tillstand.utkast.values()];
    expect(utkast?.beskrivning).toBe('Foder, Lantmännen');
    const [underlag] = [...tillstand.underlag.values()];
    expect(underlag?.verifikat).toEqual([utkast?.id]);
    expect((await lasFil(telefonen, underlag!.sha256))?.data).toEqual(KODAD);

    const verifikat = await bokforUtkast(
      telefonen,
      kontext('telefonen'),
      utkast!,
      verifikatserie('A'),
    );
    expect(verifikat.nummer).toBe(1);
  });

  it('writes nothing when only asked to check', async () => {
    const svar = await kor(['utkast', '--prova', '/tmp/forslag.json']);
    expect(svar).toContain('Inget har skickats');
    expect(svar).toContain('debet  4010 Inköp av material och varor');

    await synka(telefonen, server, krypto, 'telefonen', { hasha: hashaFil });
    expect((await lasTillstand(telefonen)).utkast.size).toBe(0);
    expect(await server.filadresser()).toEqual([]);
  });

  /*
   * A receipt sent twice would be booked twice by someone working down a
   * list of drafts. The same bytes already claimed are refused by name.
   */
  it('refuses a receipt that has been sent before', async () => {
    await kor(['utkast', '/tmp/forslag.json']);

    await expect(kor(['utkast', '/tmp/forslag.json'])).rejects.toThrow(
      'finns redan i Kontera och hör till ett utkast',
    );
  });

  it('attaches a receipt photographed in the app that is still waiting', async () => {
    const { underlag } = await sparaUnderlag(telefonen, kontext('telefonen'), {
      sha256: await hashaFil(KODAD),
      mime: 'image/jpeg',
      filnamn: 'kvitto.jpg',
      data: KODAD,
    });
    await synka(telefonen, server, krypto, 'telefonen', { hasha: hashaFil });

    await kor(['utkast', '/tmp/forslag.json']);
    await synka(telefonen, server, krypto, 'telefonen', { hasha: hashaFil });

    expect(await okoppladeUnderlag(telefonen)).toEqual([]);
    expect(
      (await lasTillstand(telefonen)).underlag.get(underlag.id)?.verifikat,
    ).toHaveLength(1);
  });

  /*
   * The device keeps nothing between runs, so fetching files would download
   * every receipt in the books every time. It reads the log and sends files,
   * and never asks for one.
   */
  it('never downloads the receipts already on the server', async () => {
    await sparaUnderlag(telefonen, kontext('telefonen'), {
      sha256: await hashaFil(new Uint8Array([9, 9, 9])),
      mime: 'image/jpeg',
      filnamn: 'gammalt.jpg',
      data: new Uint8Array([9, 9, 9]),
    });
    await synka(telefonen, server, krypto, 'telefonen', { hasha: hashaFil });

    await kor(['lage']);
    expect(server.hamtadeFiler).toBe(0);
  });

  it('describes the books it read from the server', async () => {
    expect(await kor(['lage'])).toContain('2640 Ingående moms');
  });

  it('writes its entries as its own device', async () => {
    await kor(['utkast', '/tmp/forslag.json']);
    await synka(telefonen, server, krypto, 'telefonen', { hasha: hashaFil });

    const fran = (await lasLogg(telefonen))
      .filter((post) => post.typ.startsWith('utkast') || post.typ.startsWith('underlag'))
      .map((post) => post.enhet);
    expect(new Set(fran)).toEqual(new Set(['claude-pi']));
  });
});

describe('tolkaKommando', () => {
  it('reads the four forms', () => {
    expect(tolkaKommando(['lage'])).toEqual({ typ: 'lage' });
    expect(tolkaKommando(['sok', 'foder', 'lantmännen'])).toEqual({
      typ: 'sok',
      fraga: 'foder lantmännen',
    });
    expect(tolkaKommando(['utkast', '/f.json'])).toEqual({
      typ: 'utkast',
      sokvag: '/f.json',
      prova: false,
    });
    expect(tolkaKommando(['utkast', '--prova', '/f.json'])).toEqual({
      typ: 'utkast',
      sokvag: '/f.json',
      prova: true,
    });
  });

  it('answers anything else with how it is used', () => {
    expect(() => tolkaKommando([])).toThrow('Användning');
    expect(() => tolkaKommando(['utkast'])).toThrow('Användning');
    expect(() => tolkaKommando(['bokfor', '/f.json'])).toThrow('Användning');
  });
});
