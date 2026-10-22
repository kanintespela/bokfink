import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  arBalanskonto,
  arResultatkonto,
  harledKontotyp,
  kontoklass,
  kontonummer,
  skapaKonto,
  type Kontotyp,
} from './konto';

/**
 * Accounts drawn from a real SIE export, with the #KTYP letter the
 * file gives them. Account numbers and their BAS names are the published
 * chart, not anything about whoever keeps the books.
 *
 * The mapping is one-way: SIE folds equity and debt together into S, so an
 * S here is satisfied by either of Kontera's two.
 */
const FRAN_SIE: ReadonlyArray<readonly [string, string, 'T' | 'S' | 'K' | 'I']> = [
  ['1010', 'Immateriella tillgångar', 'T'],
  ['1110', 'Byggnader', 'T'],
  ['1229', 'Ack avskr på inventarier o verktyg', 'T'],
  ['1650', 'Momsfordran', 'T'],
  ['1930', 'Företagskonto', 'T'],
  ['3010', 'Försäljning', 'I'],
  ['3740', 'Öresutjämning', 'I'],
  ['3975', 'Vinst avyttring tillgång', 'I'],
  ['4010', 'Inköp material och varor', 'K'],
  ['4990', 'Lagerförändring', 'K'],
  ['5410', 'Förbrukningsinventarier', 'K'],
  ['5420', 'Programvaror', 'K'],
  ['6540', 'IT-tjänster', 'K'],
  ['6981', 'Föreningsavgifter, avdragsgilla', 'K'],
  ['7820', 'Avskrivningar på byggnader och markanl', 'K'],
  ['7830', 'Avskrivningar på maskiner och inv', 'K'],
];

const TILL_SIE: Record<Kontotyp, 'T' | 'S' | 'K' | 'I'> = {
  tillgang: 'T',
  egetKapital: 'S',
  skuld: 'S',
  intakt: 'I',
  kostnad: 'K',
};

describe('kontonummer', () => {
  it('accepts the four-digit BAS range', () => {
    expect(kontonummer('1930')).toBe('1930');
    expect(kontonummer('8999')).toBe('8999');
    expect(kontonummer(' 2640 ')).toBe('2640');
  });

  it('rejects anything outside it', () => {
    for (const bad of ['', '193', '19300', '0999', '9000', '19a0', '1 930', '-1930']) {
      expect(() => kontonummer(bad)).toThrow(TypeError);
    }
  });

  it('reads the class off the leading digit', () => {
    expect(kontoklass(kontonummer('1930'))).toBe(1);
    expect(kontoklass(kontonummer('8999'))).toBe(8);
  });
});

describe('harledKontotyp', () => {
  it('agrees with every #KTYP a real SIE export states', () => {
    for (const [nummer, namn, sie] of FRAN_SIE) {
      const typ = harledKontotyp(kontonummer(nummer));
      expect(typ, `${nummer} ${namn}`).toBeDefined();
      expect(TILL_SIE[typ as Kontotyp], `${nummer} ${namn}`).toBe(sie);
    }
  });

  /*
   * The case the SIE import actually depends on. Some programs write no #KTYP at
   * all for class 2 - 72 accounts in the export this was checked against -
   * so the type has to come from the number or the import cannot proceed.
   */
  it('splits class 2 into equity and debt at kontogrupp 21', () => {
    // BAS kontogrupp 20 is Eget kapital; from 2100 upwards the class holds
    // untaxed reserves, provisions and debt, which the balance sheet reports
    // apart from equity.
    expect(harledKontotyp(kontonummer('2010'))).toBe('egetKapital');
    expect(harledKontotyp(kontonummer('2013'))).toBe('egetKapital');
    expect(harledKontotyp(kontonummer('2019'))).toBe('egetKapital');
    expect(harledKontotyp(kontonummer('2099'))).toBe('egetKapital');

    expect(harledKontotyp(kontonummer('2100'))).toBe('skuld');
    expect(harledKontotyp(kontonummer('2150'))).toBe('skuld');
    expect(harledKontotyp(kontonummer('2440'))).toBe('skuld');
    expect(harledKontotyp(kontonummer('2610'))).toBe('skuld');
    expect(harledKontotyp(kontonummer('2999'))).toBe('skuld');
  });

  it('declines class 8, where income and cost share a class', () => {
    // 8310 Ränteintäkter and 8410 Räntekostnader sit on opposite sides of the
    // income statement and are indistinguishable by number.
    expect(harledKontotyp(kontonummer('8310'))).toBeUndefined();
    expect(harledKontotyp(kontonummer('8410'))).toBeUndefined();
    expect(harledKontotyp(kontonummer('8999'))).toBeUndefined();
  });

  it('answers for every account outside class 8', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1000, max: 7999 }), (raw) => {
        expect(harledKontotyp(kontonummer(String(raw)))).toBeDefined();
      }),
    );
  });
});

describe('balance sheet or income statement', () => {
  it('sorts every type into exactly one of the two', () => {
    const alla: readonly Kontotyp[] = [
      'tillgang',
      'egetKapital',
      'skuld',
      'intakt',
      'kostnad',
    ];
    for (const typ of alla) {
      expect(arBalanskonto(typ)).toBe(!arResultatkonto(typ));
    }
  });

  it('keeps assets, equity and debt on the balance sheet', () => {
    expect([
      arBalanskonto('tillgang'),
      arBalanskonto('egetKapital'),
      arBalanskonto('skuld'),
    ]).toEqual([true, true, true]);
    expect([arResultatkonto('intakt'), arResultatkonto('kostnad')]).toEqual([true, true]);
  });
});

describe('skapaKonto', () => {
  it('derives the type when none is given', () => {
    expect(skapaKonto({ nummer: '1930', namn: 'Företagskonto' })).toEqual({
      nummer: '1930',
      namn: 'Företagskonto',
      typ: 'tillgang',
      aktiv: true,
      favorit: false,
      sru: [],
    });
  });

  it('takes a stated type over the derived one, which class 8 needs', () => {
    expect(skapaKonto({ nummer: '8310', namn: 'Ränteintäkter', typ: 'intakt' }).typ).toBe(
      'intakt',
    );
    expect(
      skapaKonto({ nummer: '8410', namn: 'Räntekostnader', typ: 'kostnad' }).typ,
    ).toBe('kostnad');
  });

  it('refuses class 8 without a stated type rather than picking a side', () => {
    expect(() => skapaKonto({ nummer: '8310', namn: 'Ränteintäkter' })).toThrow(
      TypeError,
    );
  });

  it('trims the padding a SIE export leaves on names', () => {
    // Some programs pad names to a fixed width, trailing space included.
    const konto = skapaKonto({
      nummer: '1079',
      namn: 'Ackumulerade avskrivningar immateriella ',
    });
    expect(konto.namn).toBe('Ackumulerade avskrivningar immateriella');
  });

  it('keeps the SRU codes an account maps to', () => {
    // 6072 maps to two boxes in the tax return, and the export states both.
    const konto = skapaKonto({
      nummer: '6072',
      namn: 'Representation, ej avdragsgill',
      sru: ['7513', '7653'],
    });
    expect(konto.sru).toEqual(['7513', '7653']);
  });

  it('refuses an account with no name', () => {
    expect(() => skapaKonto({ nummer: '1930', namn: '   ' })).toThrow(TypeError);
  });

  it('defaults to active and not a favourite', () => {
    const konto = skapaKonto({ nummer: '4010', namn: 'Inköp', favorit: true });
    expect(konto.aktiv).toBe(true);
    expect(konto.favorit).toBe(true);
  });
});
