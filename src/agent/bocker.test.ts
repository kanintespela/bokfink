import { describe, expect, it } from 'vitest';

import { synkkrypto } from '../platform/synkkrypto';
import { kannIgenBocker, listaBocker, valjBok, type Kandbok } from './bocker';

const FIRMAN: Kandbok = {
  id: 'kontera',
  beskrivning: { namn: 'Min bokföring', profil: 'enskild_firma' },
};
const FORENINGEN: Kandbok = {
  id: '01a18e57-0000-7000-8000-000000000001',
  beskrivning: { namn: 'Bygdegården', profil: 'forening' },
};
const BADA = [FIRMAN, FORENINGEN];

describe('valjBok', () => {
  it('takes the book asked for, by identity or by name in any case', () => {
    expect(valjBok(BADA, FORENINGEN.id, undefined)).toBe(FORENINGEN);
    expect(valjBok(BADA, 'bygdegården', undefined)).toBe(FORENINGEN);
    expect(valjBok(BADA, 'Min bokföring', FORENINGEN.id)).toBe(FIRMAN);
  });

  it('takes the book agent.json names when the command names none', () => {
    expect(valjBok(BADA, undefined, FORENINGEN.id)).toBe(FORENINGEN);
  });

  it('needs no choice when the server has one book', () => {
    expect(valjBok([FIRMAN], undefined, undefined)).toBe(FIRMAN);
  });

  /*
   * Beslut AE: with several books and nothing to go on, a receipt could be
   * booked in the wrong one. The assistant is told to ask, and given the list.
   */
  it('asks which book when there are several and nothing says', () => {
    expect(() => valjBok(BADA, undefined, undefined)).toThrow(
      /flera böcker[\s\S]*Bygdegården \(förening\) {2}--bok 01a18e57/,
    );
  });

  it('says so when the book asked for is not there', () => {
    expect(() => valjBok(BADA, 'Fårfirman', undefined)).toThrow('ingen bok som heter');
    expect(() => valjBok(BADA, undefined, 'borttagen')).toThrow('finns inte på servern');
  });

  it('asks for the identity when two books share a name', () => {
    const tvilling: Kandbok = { ...FORENINGEN, id: 'annan' };
    expect(() => valjBok([FORENINGEN, tvilling], 'Bygdegården', undefined)).toThrow(
      'Välj med identiteten',
    );
  });
});

describe('listaBocker', () => {
  it('reads out each book with what it is and how to choose it', () => {
    expect(listaBocker(BADA, 'kontera')).toBe(
      'Min bokföring (enskild firma)  --bok kontera  [agent.json]\n' +
        'Bygdegården (förening)  --bok 01a18e57-0000-7000-8000-000000000001\n',
    );
  });
});

describe('kannIgenBocker', () => {
  it("reads each book's description, and says why one cannot be read", async () => {
    const krypto = await synkkrypto('en lösenfras', 1000);
    const annan = await synkkrypto('en annan lösenfras', 1000);
    const lasta = await annan.kryptera(
      JSON.stringify({ namn: 'Låst', profil: 'forening' }),
    );

    const bocker = await kannIgenBocker(
      [
        { id: 'a', beskrivning: JSON.stringify({ namn: 'Öppen', profil: 'forening' }) },
        {
          id: 'b',
          beskrivning: await krypto.kryptera('{"namn":"Min","profil":"enskild_firma"}'),
        },
        { id: 'c', beskrivning: lasta },
        { id: 'd', beskrivning: undefined },
      ],
      { krypto },
    );

    expect(bocker.map((bok) => bok.beskrivning?.namn)).toEqual([
      'Öppen',
      'Min',
      undefined,
      undefined,
    ]);
    expect(bocker[2]?.fel).toContain('lösenfras som agent.json inte har');
    expect(bocker[3]?.fel).toContain('vilket slags bok');
  });
});
