import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import { kontonummer, skapaKonto, type Konto, type Kontonummer } from '../konto/konto';
import type { Uuid } from '../id/uuidv7';
import { beraknaSaldon } from '../rapport/saldon';
import { beraknaResultatrakning } from '../rapport/resultatrakning';
import { datum } from '../tid/datum';
import { verifikatserie } from '../verifikat/serie';
import { bokfor, skapaUtkast, type BokfortVerifikat } from '../verifikat/verifikat';
import { skrivCsv } from './csv';
import {
  huvudbokTabell,
  resultatrakningTabell,
  tillJson,
  verifikationslistaTabell,
} from './tabeller';

const kr = (text: string) => oreFromKronor(text);

const KONTON: ReadonlyMap<Kontonummer, Konto> = new Map(
  [
    ['1930', 'Företagskonto'],
    ['2611', 'Utgående moms 25 %'],
    ['3010', 'Försäljning'],
  ].map(([nummer, namn]) => [
    kontonummer(nummer!),
    skapaKonto({ nummer: nummer!, namn: namn! }),
  ]),
);

const FORSALJNING: BokfortVerifikat = bokfor(
  skapaUtkast({
    id: '019b76da-a800-7000-8000-000000000001' as Uuid,
    datum: datum('2026-02-13'),
    beskrivning: 'Försäljning; kontant',
    konteringar: [
      { konto: kontonummer('1930'), belopp: kr('12500.00') },
      { konto: kontonummer('3010'), belopp: kr('-10000.00') },
      { konto: kontonummer('2611'), belopp: kr('-2500.00') },
    ],
  }),
  {
    serie: verifikatserie('A'),
    nummer: 1,
    bokfortDatum: datum('2026-02-13'),
    kalla: 'manuell',
  },
);

describe('verifikationslistaTabell', () => {
  const tabell = verifikationslistaTabell([FORSALJNING], KONTON);

  /*
   * Debit and credit get a column each. That is how everyone who receives a
   * bookkeeping export reads one, and a minus sign in a column headed
   * "Belopp" is the kind of thing that is misread once and trusted after.
   */
  it('splits each posting into debit and credit', () => {
    const csv = skrivCsv(tabell);
    expect(csv).toContain(
      'A1;2026-02-13;"Försäljning; kontant";1930;Företagskonto;12500,00;',
    );
    expect(csv).toContain(';3010;Försäljning;;10000,00');
  });

  it('quotes a description that contains the separator', () => {
    // The whole reason the quoting rules exist: a description is free text.
    expect(skrivCsv(tabell)).toContain('"Försäljning; kontant"');
  });
});

describe('huvudbokTabell', () => {
  const saldon = beraknaSaldon(
    [{ konto: kontonummer('1930'), belopp: kr('1000.00') }],
    [FORSALJNING],
  );
  const tabell = huvudbokTabell(saldon, [FORSALJNING], KONTON);
  const csv = skrivCsv(tabell);

  it('opens and closes each account, with a running balance between', () => {
    expect(csv).toContain('1930;Företagskonto;;;Ingående balans;;;1000,00');
    expect(csv).toContain('1930;Företagskonto;A1;2026-02-13;');
    // 1 000 brought in plus 12 500 received.
    expect(csv).toContain(';12500,00;;13500,00');
    expect(csv).toContain('1930;Företagskonto;;;Utgående balans;;;13500,00');
  });

  it('carries every account that moved', () => {
    expect(csv).toContain('3010;Försäljning;;;Utgående balans;;;-10000,00');
  });
});

describe('resultatrakningTabell', () => {
  it('writes the groups, their subtotals and the result', () => {
    const rapport = beraknaResultatrakning(beraknaSaldon([], [FORSALJNING]), KONTON);
    const csv = skrivCsv(resultatrakningTabell(rapport));

    expect(csv).toContain('Rörelsens intäkter;3010;Försäljning;10000,00');
    expect(csv).toContain('Summa rörelsens intäkter;;;10000,00');
    expect(csv).toContain('Periodens resultat;;;10000,00');
  });
});

describe('tillJson', () => {
  it('uses the header row as keys', () => {
    const poster = tillJson(verifikationslistaTabell([FORSALJNING], KONTON));
    expect(poster[0]).toMatchObject({
      Verifikat: 'A1',
      Datum: '2026-02-13',
      Konto: '1930',
      Kontonamn: 'Företagskonto',
    });
  });

  /*
   * Whole öre, not decimals. Anything reading JSON is a program, and a
   * program that reads 520.31 has already put the amount through a float,
   * which hard rule 1 forbids.
   */
  it('writes amounts as whole öre', () => {
    const poster = tillJson(verifikationslistaTabell([FORSALJNING], KONTON)) as Record<
      string,
      unknown
    >[];
    expect(poster[0]?.['Debet']).toBe(1250000);
    expect(poster[0]?.['Kredit']).toBeNull();
  });
});
