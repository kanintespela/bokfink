import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import { uuidv7, type Uuid } from '../id/uuidv7';
import { kontonummer } from '../konto/konto';
import { datum } from '../tid/datum';
import { verifikatserie } from './serie';
import { annullera, bokfor, skapaUtkast, type BokfortVerifikat } from './verifikat';
import { betalning, fakturor, FelBetalningError, oppnaFakturor } from './reskontra';

const kr = oreFromKronor;
let n = 0;
const nyttId = () => uuidv7(1_788_554_000_000 + (n += 1), new Uint8Array(10).fill(3));
const MALL = nyttId();

function bokfort(
  datumtext: string,
  rader: [string, string][],
  extra: { mall?: Uuid; betalar?: Uuid; text?: string } = {},
): BokfortVerifikat {
  const nummer = (n += 1);
  return bokfor(
    skapaUtkast({
      id: nyttId(),
      datum: datum(datumtext),
      beskrivning: extra.text ?? 'Faktura',
      konteringar: rader.map(([konto, belopp]) => ({
        konto: kontonummer(konto),
        belopp: kr(belopp),
      })),
      ...(extra.mall === undefined ? {} : { mall: extra.mall }),
      ...(extra.betalar === undefined ? {} : { betalar: extra.betalar }),
    }),
    { serie: verifikatserie('A'), nummer, bokfortDatum: datum(datumtext), kalla: 'mall' },
  );
}

const kundfaktura = () =>
  bokfort(
    '2026-03-01',
    [
      ['1500', '1250'],
      ['3000', '-1000'],
      ['2611', '-250'],
    ],
    { mall: MALL, text: 'Kurs i biodling' },
  );

const leverantorsfaktura = () =>
  bokfort(
    '2026-03-05',
    [
      ['5400', '800'],
      ['2641', '200'],
      ['2440', '-1000'],
    ],
    { mall: MALL, text: 'Burkar' },
  );

describe('fakturor', () => {
  it('finds a customer invoice and a supplier invoice, with the amount owed', () => {
    const alla = [kundfaktura(), leverantorsfaktura()];
    const lista = fakturor(alla);

    expect(lista.map((f) => [f.slag, f.belopp, f.kvar])).toEqual([
      ['kund', kr('1250'), kr('1250')],
      ['leverantor', kr('1000'), kr('1000')],
    ]);
  });

  it('subtracts what has been paid, also in parts', () => {
    const faktura = kundfaktura();
    const forsta = fakturor([faktura])[0]!;
    const del = bokfort(
      '2026-03-20',
      [
        ['1930', '500'],
        ['1500', '-500'],
      ],
      { betalar: faktura.id },
    );

    const efter = fakturor([faktura, del])[0]!;
    expect(forsta.kvar).toBe(kr('1250'));
    expect(efter.betalt).toBe(kr('500'));
    expect(efter.kvar).toBe(kr('750'));
    expect(oppnaFakturor([faktura, del])).toHaveLength(1);
  });

  it('drops an invoice from the open ones once it is paid in full', () => {
    const faktura = leverantorsfaktura();
    const betald = bokfort(
      '2026-04-01',
      [
        ['2440', '1000'],
        ['1930', '-1000'],
      ],
      { betalar: faktura.id },
    );

    expect(oppnaFakturor([faktura, betald])).toEqual([]);
    expect(fakturor([faktura, betald])[0]?.kvar).toBe(kr('0'));
  });

  it('counts a payment that was annulled as not paid', () => {
    const faktura = kundfaktura();
    const betald = bokfort(
      '2026-03-20',
      [
        ['1930', '1250'],
        ['1500', '-1250'],
      ],
      { betalar: faktura.id },
    );
    const spegel = bokfor(
      annullera(betald, { id: nyttId(), datum: datum('2026-03-21') }),
      {
        serie: verifikatserie('A'),
        nummer: (n += 1),
        bokfortDatum: datum('2026-03-21'),
        kalla: 'manuell',
      },
    );

    expect(oppnaFakturor([faktura, betald, spegel]).map((f) => f.kvar)).toEqual([
      kr('1250'),
    ]);
  });

  it('leaves out an invoice that was annulled', () => {
    const faktura = kundfaktura();
    const spegel = bokfor(
      annullera(faktura, { id: nyttId(), datum: datum('2026-03-02') }),
      {
        serie: verifikatserie('A'),
        nummer: (n += 1),
        bokfortDatum: datum('2026-03-02'),
        kalla: 'manuell',
      },
    );

    expect(fakturor([faktura, spegel])).toEqual([]);
  });

  it('does not take a year-end periodisering for an invoice', () => {
    const periodisering = bokfort('2026-12-31', [
      ['1500', '1250'],
      ['3000', '-1250'],
    ]);

    expect(fakturor([periodisering])).toEqual([]);
  });
});

describe('betalning', () => {
  it('books a customer payment into the account and clears the receivable', () => {
    const faktura = fakturor([kundfaktura()])[0]!;
    const utkast = betalning(faktura, {
      id: nyttId(),
      datum: datum('2026-03-20'),
      belopp: kr('1250'),
      betalkonto: kontonummer('1930'),
      beteckning: 'A1',
    });

    expect(utkast.betalar).toBe(faktura.verifikat.id);
    expect(utkast.konteringar.map((r) => [r.konto, r.belopp])).toEqual([
      ['1930', kr('1250')],
      ['1500', kr('-1250')],
    ]);
    expect(utkast.beskrivning).toBe('Betalning av A1: Kurs i biodling');
  });

  it('books a supplier payment out of the account and clears the payable', () => {
    const faktura = fakturor([leverantorsfaktura()])[0]!;
    const utkast = betalning(faktura, {
      id: nyttId(),
      datum: datum('2026-04-01'),
      belopp: kr('400'),
      betalkonto: kontonummer('1930'),
      beteckning: 'A2',
    });

    expect(utkast.konteringar.map((r) => [r.konto, r.belopp])).toEqual([
      ['2440', kr('400')],
      ['1930', kr('-400')],
    ]);
  });

  it('refuses more than is left, and nothing', () => {
    const faktura = fakturor([kundfaktura()])[0]!;
    const grund = {
      id: nyttId(),
      datum: datum('2026-03-20'),
      betalkonto: kontonummer('1930'),
      beteckning: 'A1',
    };

    expect(() => betalning(faktura, { ...grund, belopp: kr('1250.01') })).toThrow(
      FelBetalningError,
    );
    expect(() => betalning(faktura, { ...grund, belopp: kr('0') })).toThrow(
      FelBetalningError,
    );
  });
});
