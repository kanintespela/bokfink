import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import { SieError, tolkaSie } from './parser';

/** A minimal but complete file, shaped like a real export. */
const HUVUD = [
  '#FLAGGA 0',
  '#PROGRAM "Exempelbok" "2026-09-04"',
  '#FORMAT PC8',
  '#GEN 20260904 "Anna Exempel"',
  '#SIETYP 4',
  '#VALUTA SEK',
  '#RAR 0 20260101 20261231',
  '#RAR -1 20250101 20251231',
];

const fil = (...rader: string[]) => [...HUVUD, ...rader].join('\n');

describe('tolkaSie', () => {
  it('reads the header', () => {
    const doc = tolkaSie(fil('#ORGNR 1234567890', '#FNAMN "Ett Företag"'));
    expect(doc.sietyp).toBe(4);
    expect(doc.format).toBe('PC8');
    expect(doc.valuta).toBe('SEK');
    expect(doc.foretagsnamn).toBe('Ett Företag');
  });

  it('reads fiscal years with their index', () => {
    expect(tolkaSie(fil()).rakenskapsar).toEqual([
      { index: 0, start: '2026-01-01', slut: '2026-12-31' },
      { index: -1, start: '2025-01-01', slut: '2025-12-31' },
    ]);
  });

  it('joins accounts with their type and SRU codes', () => {
    const doc = tolkaSie(
      fil(
        '#KONTO 1930 "Företagskonto"',
        '#KONTO 6072 "Representation, ej avdragsgill"',
        '#KTYP 1930 T',
        '#SRU 1930 7281',
        // An account may map to more than one SRU code, and this one does.
        '#SRU 6072 7513',
        '#SRU 6072 7653',
      ),
    );

    expect(doc.konton).toEqual([
      { nummer: '1930', namn: 'Företagskonto', typ: 'T', sru: ['7281'] },
      {
        nummer: '6072',
        namn: 'Representation, ej avdragsgill',
        sru: ['7513', '7653'],
      },
    ]);
  });

  /*
   * Some programs write no #KTYP at all for account class 2 - 72 accounts in the
   * real export - so an absent type has to be an ordinary outcome rather than
   * an error. The ledger derives it from the number instead.
   */
  it('leaves the type out when the file does not state one', () => {
    const doc = tolkaSie(fil('#KONTO 2013 "Eget uttag/insättningar"'));
    expect(doc.konton[0]?.typ).toBeUndefined();
  });

  it('reads balances against the year they belong to', () => {
    const doc = tolkaSie(
      fil(
        '#IB 0 1110 52418.37',
        '#IB -1 1110 52418.37',
        '#UB 0 2010 -312906.48',
        '#RES 0 4010 1987.40',
      ),
    );
    expect(doc.ingaende).toEqual([
      { arsindex: 0, konto: '1110', belopp: oreFromKronor('52418.37') },
      { arsindex: -1, konto: '1110', belopp: oreFromKronor('52418.37') },
    ]);
    expect(doc.utgaende[0]?.belopp).toBe(oreFromKronor('-312906.48'));
    expect(doc.resultat[0]?.belopp).toBe(oreFromKronor('1987.40'));
  });

  it('reads a verifikat with its lines', () => {
    const doc = tolkaSie(
      fil(
        '#VER "A" 2 20260109 "Inköp av mineralfoder" 20260112 ""',
        '{',
        '#TRANS 2013 {} -520.31 20260109 "" 0.0',
        '#TRANS 2640 {} 104.06 20260109 "" 0.0',
        '#TRANS 4010 {} 416.25 20260109 "" 0.0',
        '}',
      ),
    );

    expect(doc.verifikat).toHaveLength(1);
    const ver = doc.verifikat[0]!;
    expect(ver.serie).toBe('A');
    expect(ver.nummer).toBe('2');
    expect(ver.datum).toBe('2026-01-09');
    expect(ver.registrerad).toBe('2026-01-12');
    expect(ver.text).toBe('Inköp av mineralfoder');
    expect(ver.transaktioner.map((t) => t.belopp)).toEqual([
      oreFromKronor('-520.31'),
      oreFromKronor('104.06'),
      oreFromKronor('416.25'),
    ]);
  });

  it('keeps two series apart, which the 2023 file has', () => {
    const doc = tolkaSie(
      fil(
        '#VER "V" 35 20230810 "Röd färg" 20241028 ""',
        '{',
        '#TRANS 5000 {} 1247.20',
        '#TRANS 2013 {} -1247.20',
        '}',
        '#VER "A" 1 20230926 "Försäljning" 20241028 ""',
        '{',
        '#TRANS 1930 {} 26400.00',
        '#TRANS 3048 {} -26400.00',
        '}',
      ),
    );
    expect(doc.verifikat.map((v) => `${v.serie}${v.nummer}`)).toEqual(['V35', 'A1']);
  });

  it('accepts the awkward shapes real books contain', () => {
    const doc = tolkaSie(
      fil(
        // A verifikat with no description at all.
        '#VER "A" 9 20240113 "" 20241028 ""',
        '{',
        '#TRANS 5460 {} 551.20',
        '#TRANS 2013 {} -551.20',
        '}',
        // One that keeps a zero line and books twice on the same account.
        '#VER "A" 52 20251214 "Eget uttag" 20251214 ""',
        '{',
        '#TRANS 2013 {} 0.00',
        '#TRANS 1930 {} -2500.00',
        '#TRANS 2013 {} 2500.00',
        '}',
      ),
    );

    expect(doc.verifikat[0]?.text).toBe('');
    expect(doc.verifikat[1]?.transaktioner).toHaveLength(3);
    expect(doc.verifikat[1]?.transaktioner[0]?.belopp).toBe(0);
  });

  it('keeps a per-line note when there is one', () => {
    const doc = tolkaSie(
      fil(
        '#VER "A" 23 20260331 "Automatisk momsöverföring" 20260602 ""',
        '{',
        '#TRANS 2640 {} -4210.37 20260331 "Period 202603" 0.0',
        '#TRANS 2650 {} 4210.00 20260331 "Period 202603" 0.0',
        '#TRANS 3740 {} 0.37 20260331 "Period 202603" 0.0',
        '}',
      ),
    );
    expect(doc.verifikat[0]?.transaktioner[0]?.text).toBe('Period 202603');
  });

  it('records labels it does not know rather than dropping them', () => {
    const doc = tolkaSie(fil('#NAGOTNYTT 1 2 3'));
    expect(doc.okandaEtiketter).toEqual(['NAGOTNYTT']);
  });

  it('refuses a file that is not SIE type 4', () => {
    const text = fil().replace('#SIETYP 4', '#SIETYP 1');
    expect(() => tolkaSie(text)).toThrow(/typ 1/);
  });

  it('refuses a file with no #SIETYP', () => {
    expect(() => tolkaSie('#FLAGGA 0')).toThrow(/saknar #SIETYP/);
  });

  it('refuses a character set the format does not define', () => {
    const text = fil().replace('#FORMAT PC8', '#FORMAT UTF8');
    expect(() => tolkaSie(text)).toThrow(/UTF8/);
  });

  it('refuses a date that is not ÅÅÅÅMMDD', () => {
    expect(() => tolkaSie(fil('#VER "A" 1 2026-01-09 "x"'))).toThrow(SieError);
    expect(() => tolkaSie(fil('#VER "A" 1 20260230 "x"'))).toThrow(/finns inte/);
  });

  it('refuses an amount that is not a decimal', () => {
    expect(() =>
      tolkaSie(fil('#VER "A" 1 20260109 "x"', '{', '#TRANS 4010 {} inte-ett-tal', '}')),
    ).toThrow(SieError);
  });

  it('refuses a record that is missing a required field', () => {
    expect(() => tolkaSie(fil('#KONTO 1930'))).toThrow(/saknar kontonamn/);
    expect(() => tolkaSie(fil('#RAR 0 20260101'))).toThrow(/saknar slutdatum/);
  });

  it('points at the line that failed', () => {
    expect(() => tolkaSie(fil('#KONTO 1930 "OK"', '#KONTO 1940'))).toThrow(/Rad 10/);
  });
});
