import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import { OgiltigRegisterfilError, tolkaRegisterfil } from './registerfil';

const fil = (innehall: object) =>
  JSON.stringify({ format: 'bokfink-anlaggningsregister', version: 1, ...innehall });

const TRAKTOR = {
  benamning: 'John Deere 2120',
  anskaffningsdatum: '2024-04-20',
  anskaffningsvarde: '50000',
  nyttjandeperiod: 5,
};

/*
 * A building bought in 2011 for 77 734 kr and written off at 4 % for three
 * years: 3 × 3 109,36 = 9 328,08 kr already written off.
 */
const BYGGNAD = {
  benamning: 'B2 ekonomibyggnader',
  anskaffningsdatum: '2011-12-01',
  anskaffningsvarde: '77734',
  kategori: 'byggnad',
  byggnadstyp: 'ekonomibyggnad_ovrig',
  ackumuleradAvskrivning: '9328,08',
};

describe('tolkaRegisterfil', () => {
  it('reads machines and property components, each into its own register', () => {
    const register = tolkaRegisterfil(
      fil({ inventarier: [TRAKTOR], fastighet: [BYGGNAD] }),
    );

    expect(register.inventarier).toEqual([
      {
        benamning: 'John Deere 2120',
        anskaffningsdatum: '2024-04-20',
        anskaffningsvarde: oreFromKronor('50000'),
        nyttjandeperiod: 5,
      },
    ]);
    expect(register.fastighet).toEqual([
      {
        benamning: 'B2 ekonomibyggnader',
        anskaffningsdatum: '2011-12-01',
        anskaffningsvarde: oreFromKronor('77734'),
        kategori: { typ: 'byggnad', byggnadstyp: 'ekonomibyggnad_ovrig' },
        ackumuleradAvskrivning: oreFromKronor('9328.08'),
      },
    ]);
  });

  it('takes nothing written off to mean nothing, for land and forest too', () => {
    const { fastighet } = tolkaRegisterfil(
      fil({
        fastighet: [
          {
            benamning: 'B3 skog',
            anskaffningsdatum: '2011-12-01',
            anskaffningsvarde: '265922',
            kategori: 'skog',
          },
        ],
      }),
    );

    expect(fastighet[0]).toMatchObject({
      kategori: { typ: 'skog' },
      ackumuleradAvskrivning: 0,
    });
  });

  it.each([
    ['not JSON', 'ANLÄGGNINGSTILLGÅNGAR;;;'],
    ['some other JSON', '{"handelser":[]}'],
    ['a list', '[]'],
  ])('refuses %s as not being a register', (_vad, text) => {
    expect(() => tolkaRegisterfil(text)).toThrow('inte ett anläggningsregister');
  });

  it('refuses a version it does not know', () => {
    expect(() =>
      tolkaRegisterfil(
        JSON.stringify({ format: 'bokfink-anlaggningsregister', version: 2 }),
      ),
    ).toThrow('annan version');
  });

  it('refuses a file with nothing in it', () => {
    expect(() => tolkaRegisterfil(fil({ inventarier: [] }))).toThrow('inga anläggningar');
  });

  /*
   * Hard rule 1. A JSON number is a float, and 9328.08 as one is not the
   * amount it looks like.
   */
  it('refuses an amount written as a number', () => {
    expect(() =>
      tolkaRegisterfil(fil({ inventarier: [{ ...TRAKTOR, anskaffningsvarde: 50000 }] })),
    ).toThrow('som text i kronor');
  });

  /*
   * All or nothing, and the message says where. Half a register taken in
   * hides what is missing.
   */
  it('names the row and the asset when one entry is wrong, and takes none', () => {
    const trasig = fil({
      inventarier: [TRAKTOR],
      fastighet: [
        BYGGNAD,
        { ...BYGGNAD, benamning: 'Ladan', anskaffningsdatum: '2011-13-01' },
      ],
    });

    expect(() => tolkaRegisterfil(trasig)).toThrow(OgiltigRegisterfilError);
    expect(() => tolkaRegisterfil(trasig)).toThrow('Rad 2 under fastighet (Ladan)');
  });

  it.each([
    ['a kind that does not exist', { kategori: 'stangsel' }, 'kategorin "stangsel"'],
    [
      'a building type that does not exist',
      { byggnadstyp: 'lada' },
      'byggnadstypen "lada"',
    ],
    [
      'more written off than it cost',
      { ackumuleradAvskrivning: '80000' },
      'Ackumulerad avskrivning',
    ],
    ['a cost of nothing', { anskaffningsvarde: '0' }, 'större än noll'],
    ['no name', { benamning: ' ' }, 'benämning'],
  ])('refuses %s', (_vad, andring, del) => {
    expect(() =>
      tolkaRegisterfil(fil({ fastighet: [{ ...BYGGNAD, ...andring }] })),
    ).toThrow(del);
  });

  it('refuses a machine with no useful life', () => {
    expect(() =>
      tolkaRegisterfil(fil({ inventarier: [{ ...TRAKTOR, nyttjandeperiod: 0 }] })),
    ).toThrow('Nyttjandeperioden');
  });
});
