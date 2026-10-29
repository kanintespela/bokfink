import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';

import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { skapaKonto } from '../domain/konto/konto';
import { skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import type { Underlag } from '../domain/underlag/underlag';
import { lasTillstand } from '../data/bokforing';
import { KonteraDatabase } from '../data/db';
import { skrivKonto, skrivRakenskapsar } from '../data/kommandon';
import { synka, type Fjarrpost, type Synktransport } from '../data/synk';
import { sparaUnderlag } from '../data/underlag';
import { hashaFil } from '../platform/hash';
import { synkkrypto } from '../platform/synkkrypto';
import { korAgent, tolkaKommando, type Agentberoenden } from './agent';
import { kvittonAttLasa, type Kvittovakt, type Vaktminne } from './vakt';

let raknare = 0;
let klockslag = 1_789_000_000_000;
const nyttId = () => uuidv7((klockslag += 1), new Uint8Array(10).fill(4));
const kontext = (enhet: string) => ({
  enhet,
  nu: () => '2026-09-12T18:00:00.000Z',
  nyttId,
});

const BILD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7]);

const AVLASNING = {
  leverantor: 'Exempelmacken',
  orgnr: '556000-0001',
  datum: '2026-09-10',
  betalat: '500.00',
  betalsatt: 'kort',
  rader: [{ momssats: 25, netto: '400.00', moms: '100.00' }],
  avrundning: '0.00',
  sokord: ['diesel'],
  sakerhet: 'hog',
  kommentar: '',
};

const KONTERING = {
  beskrivning: 'Exempelmacken: diesel',
  konteringar: [
    { konto: '5400', belopp: '400.00' },
    { konto: '2640', belopp: '100.00' },
    { konto: '2013', belopp: '-500.00' },
  ],
  motivering: 'Som tidigare dieselköp.',
};

/** A server in memory with the unique indexes the real one has. */
function fejkserver(): Synktransport {
  const poster: Fjarrpost[] = [];
  const filer = new Map<string, Uint8Array>();
  return {
    hamta: async (markor) => {
      const efter = markor === undefined ? '' : `${markor.created}|${markor.id}`;
      return poster.filter((post) => `${post.created}|${post.id}` > efter);
    },
    skicka: async (nya) => {
      for (const post of nya) {
        if (!poster.some((redan) => redan.op_id === post.op_id)) {
          const lopnummer = String(poster.length + 1).padStart(6, '0');
          poster.push({ ...post, created: lopnummer, id: `rad${lopnummer}` });
        }
      }
    },
    filadresser: async () => [...filer.keys()],
    skickaFil: async (adress, chiffer) => {
      filer.set(adress, chiffer);
    },
    hamtaFil: async (adress) => filer.get(adress),
  };
}

describe('the receipt watcher', () => {
  let server: Synktransport;
  let telefonen: KonteraDatabase;
  let minne: Vaktminne;
  let meddelanden: string[];
  let fragor: { fraga: string; bild?: Uint8Array }[];
  let svar: (fraga: string, bild?: Uint8Array) => string;

  const nyDb = async (namn: string) => {
    const db = new KonteraDatabase(`kontera-vakt-${namn}-${(raknare += 1)}`);
    await db.open();
    return db;
  };

  const vakt = (): Kvittovakt => ({
    fran: datum('2026-09-01'),
    maxPerKorning: 3,
    maxPerDygn: 20,
    las: async (fraga, bild) => {
      fragor.push({ fraga, ...(bild === undefined ? {} : { bild: bild.data }) });
      return svar(fraga, bild?.data);
    },
    minne: {
      hamta: async () => minne,
      spara: async (nytt) => {
        minne = nytt;
      },
    },
    meddela: async (text) => {
      meddelanden.push(text);
    },
  });

  const kor = async (argv: string[]) =>
    korAgent(await nyDb('pi'), tolkaKommando(argv), {
      transport: server,
      krypto: await synkkrypto(undefined),
      enhet: 'claude-pi',
      nu: () => '2026-09-12T18:05:00.000Z',
      idag: () => datum('2026-09-12'),
      nyttId,
      hasha: hashaFil,
      lasFil: async () => BILD,
      lasText: async () => '',
      kodaBild: async () => BILD,
      vakt: vakt(),
    } satisfies Agentberoenden);

  const fran = async () => {
    await synka(telefonen, server, await synkkrypto(undefined), 'telefonen', {
      hasha: hashaFil,
    });
    return lasTillstand(telefonen);
  };

  beforeEach(async () => {
    server = fejkserver();
    minne = { forsok: {} };
    meddelanden = [];
    fragor = [];
    svar = (_fraga, bild) => JSON.stringify(bild === undefined ? KONTERING : AVLASNING);

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
      ['5400', 'Förbrukningsinventarier'],
      ['2640', 'Ingående moms'],
      ['2013', 'Eget uttag'],
    ] as const) {
      await skrivKonto(telefonen, kontext('telefonen'), skapaKonto({ nummer, namn }));
    }
    // The receipt photographed in the app and synced, picture included.
    await sparaUnderlag(telefonen, kontext('telefonen'), {
      sha256: await hashaFil(BILD),
      mime: 'image/jpeg',
      filnamn: 'kvitto.jpg',
      data: BILD,
    });
    await fran();
  });

  /*
   * The whole round: a photographed receipt becomes a draft linked to that
   * same receipt, and the owner is told. Nothing is booked.
   */
  it('turns a photographed receipt into a draft of its own', async () => {
    const rapport = await kor(['las-nya']);
    expect(rapport).toContain('Nytt utkast: Exempelmacken: diesel');

    const tillstand = await fran();
    expect(tillstand.verifikat.size).toBe(0);
    const [utkast] = [...tillstand.utkast.values()];
    expect(utkast?.konteringar).toHaveLength(3);
    expect(utkast?.motivering).toBe('Som tidigare dieselköp.');
    const [kvitto] = [...tillstand.underlag.values()];
    expect(kvitto?.verifikat).toEqual([utkast?.id]);
    expect(tillstand.underlag.size).toBe(1);

    expect(meddelanden).toHaveLength(1);
    expect(meddelanden[0]).toContain('Som tidigare dieselköp.');
    expect(Object.values(minne.forsok)[0]?.utfall).toBe('utkast');

    // Read once: the link in the books is what marks it as done.
    expect(await kor(['las-nya'])).toContain('Inga nya kvitton');
  });

  /* The picture goes with the first question only; the books with the second. */
  it('asks about the picture first and the books second', async () => {
    await kor(['las-nya']);

    expect(fragor).toHaveLength(2);
    expect(fragor[0]?.bild).toEqual(BILD);
    expect(fragor[1]?.bild).toBeUndefined();
    expect(fragor[1]?.fraga).toContain('5400 Förbrukningsinventarier');
    expect(fragor[1]?.fraga).toContain('"betalat":"500.00"');
  });

  it('only shows the suggestion when asked to check', async () => {
    expect(await kor(['las-nya', '--prova'])).toContain('Förslag (inget skickat)');

    expect((await fran()).utkast.size).toBe(0);
    expect(meddelanden).toEqual([]);
    expect(minne.forsok).toEqual({});
  });

  /*
   * A reading that does not add up becomes no draft. It is tried once more,
   * and when that fails too the owner is told once and it is left alone.
   */
  it('gives up on a receipt after two failed readings, and says so once', async () => {
    svar = (_fraga, bild) =>
      JSON.stringify(
        bild === undefined ? KONTERING : { ...AVLASNING, betalat: '510.00' },
      );

    expect(await kor(['las-nya'])).toContain('kunde inte läsas');
    expect(meddelanden).toEqual([]);
    await kor(['las-nya']);
    expect(meddelanden).toHaveLength(1);
    expect(meddelanden[0]).toContain('Bokför det för hand');

    expect(await kor(['las-nya'])).toContain('Inga nya kvitton');
    expect((await fran()).utkast.size).toBe(0);
  });

  /* A booking on an account the books do not have is refused by the review. */
  it('refuses a booking the review would refuse', async () => {
    svar = (_fraga, bild) =>
      JSON.stringify(
        bild === undefined
          ? {
              ...KONTERING,
              konteringar: [
                { konto: '5611', belopp: '400.00' },
                { konto: '2640', belopp: '100.00' },
                { konto: '2013', belopp: '-500.00' },
              ],
            }
          : AVLASNING,
      );

    expect(await kor(['las-nya'])).toContain('Konto 5611 finns inte i kontoplanen');
    expect((await fran()).utkast.size).toBe(0);
  });
});

describe('kvittonAttLasa', () => {
  const kvitto = (id: string, tillagd: string, verifikat: string[] = []) =>
    ({ id, tillagd, verifikat }) as unknown as Underlag;
  const IDAG = datum('2026-10-28');
  const GRANSER = { fran: datum('2026-10-01'), maxPerKorning: 2, maxPerDygn: 5 };

  it('takes waiting receipts added from the start day, oldest first', () => {
    const lista = kvittonAttLasa(
      [
        kvitto('c', '2026-10-27T10:00:00Z'),
        kvitto('gammalt', '2026-09-30T10:00:00Z'),
        kvitto('kopplat', '2026-10-27T09:00:00Z', ['v1']),
        kvitto('b', '2026-10-26T10:00:00Z'),
        kvitto('a', '2026-10-25T10:00:00Z'),
      ],
      { forsok: {} },
      GRANSER,
      IDAG,
    );
    expect(lista.map((post) => post.id)).toEqual(['a', 'b']);
  });

  it('stops for the day at the daily limit', () => {
    const forsok = Object.fromEntries(
      ['x', 'y', 'z', 'v'].map((id) => [
        id,
        {
          antal: 1,
          senast: '2026-10-28T08:00:00Z',
          utfall: 'utkast' as const,
          meddelande: '',
        },
      ]),
    );
    const lista = kvittonAttLasa(
      [kvitto('a', '2026-10-25T10:00:00Z'), kvitto('b', '2026-10-26T10:00:00Z')],
      { forsok },
      GRANSER,
      IDAG,
    );
    expect(lista.map((post) => post.id)).toEqual(['a']);
  });
});
