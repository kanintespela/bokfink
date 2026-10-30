import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { avkodaPC8, kodaPC8, medPC8Motsvarigheter, OkodbartTeckenError } from './pc8';

const bytes = (...v: number[]) => new Uint8Array(v);

describe('avkodaPC8', () => {
  it('passes ASCII through', () => {
    expect(avkodaPC8(new TextEncoder().encode('#KONTO 1930 "Foretagskonto"'))).toBe(
      '#KONTO 1930 "Foretagskonto"',
    );
  });

  /*
   * The bytes that matter. These are taken from a real SIE export, where
   * 0x86 0x84 0x94 are exactly the å ä ö that a naive latin-1 read destroys.
   */
  it('decodes the Swedish letters PC8 places outside ASCII', () => {
    expect(avkodaPC8(bytes(0x86, 0x84, 0x94))).toBe('åäö');
    expect(avkodaPC8(bytes(0x8f, 0x8e, 0x99))).toBe('ÅÄÖ');
  });

  it('reads real lines from the export', () => {
    // #KONTO 1150 "Markanläggningar"
    const rad = bytes(
      0x4d,
      0x61,
      0x72,
      0x6b,
      0x61,
      0x6e,
      0x6c,
      0x84,
      0x67,
      0x67,
      0x6e,
      0x69,
      0x6e,
      0x67,
      0x61,
      0x72,
    );
    expect(avkodaPC8(rad)).toBe('Markanläggningar');
  });

  it('never leaves a byte undecoded', () => {
    const alla = new Uint8Array(256).map((_, i) => i);
    expect(avkodaPC8(alla)).not.toContain('�');
    expect(avkodaPC8(alla)).toHaveLength(256);
  });
});

describe('kodaPC8', () => {
  it('round-trips every byte the format has', () => {
    const alla = new Uint8Array(256).map((_, i) => i);
    expect(kodaPC8(avkodaPC8(alla))).toEqual(alla);
  });

  it('round-trips text through both directions', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (raw) => {
        expect(kodaPC8(avkodaPC8(raw))).toEqual(raw);
      }),
    );
  });

  it('writes the Swedish letters back as PC8, not latin-1', () => {
    expect(kodaPC8('åäö')).toEqual(bytes(0x86, 0x84, 0x94));
    // Latin-1 would have produced 0xe5 0xe4 0xf6, which PC8 reads as Greek.
    expect(avkodaPC8(bytes(0xe5, 0xe4, 0xf6))).toBe('σΣ÷');
  });

  /*
   * Refusing rather than substituting. A silently mangled name in an exported
   * file is the sort of thing nobody notices until an accountant asks what it
   * was supposed to say.
   */
  it('refuses a character PC8 cannot hold', () => {
    for (const omojligt of ['€', 'ł', '☺', '😀']) {
      expect(() => kodaPC8(omojligt)).toThrow(OkodbartTeckenError);
    }
  });

  it('names the character it refused', () => {
    expect(() => kodaPC8('Räksmörgås €')).toThrow(/"€"/);
  });
});

/*
 * 2026-10-30: an invoice period "Oct 5–Nov 5" on a booked verifikat stopped
 * the whole archive, because the en dash is not in PC8.
 */
describe('medPC8Motsvarigheter', () => {
  it('writes dashes, quotes, ellipsis, euro and odd spaces the plain way', () => {
    expect(medPC8Motsvarigheter('Oct 5–Nov 5, 2026')).toBe('Oct 5-Nov 5, 2026');
    expect(medPC8Motsvarigheter('a—b')).toBe('a-b');
    expect(medPC8Motsvarigheter('Det “stora” lägret')).toBe('Det "stora" lägret');
    expect(medPC8Motsvarigheter('Annas bil‘s')).toBe("Annas bil's");
    expect(medPC8Motsvarigheter('Vänta…')).toBe('Vänta...');
    expect(medPC8Motsvarigheter('22,50 €')).toBe('22,50 EUR');
    expect(medPC8Motsvarigheter('1\u00A0000')).toBe('1 000');
    expect(medPC8Motsvarigheter('a\u200Bb')).toBe('ab');
  });

  it('leaves what PC8 already holds exactly as it is', () => {
    expect(medPC8Motsvarigheter('Räksmörgås åäöÅÄÖ é ü ñ 1-2 "x"')).toBe(
      'Räksmörgås åäöÅÄÖ é ü ñ 1-2 "x"',
    );
  });

  it('makes text that kodaPC8 accepts, which is the point', () => {
    expect(() =>
      kodaPC8(medPC8Motsvarigheter('Claude Pro Oct 5–Nov 5, 2026 – 22,50 €')),
    ).not.toThrow();
  });

  it('does not guess at a character with no plain equivalent', () => {
    expect(medPC8Motsvarigheter('☺ 😀 ł')).toBe('☺ 😀 ł');
    expect(() => kodaPC8(medPC8Motsvarigheter('Läger 😀'))).toThrow(OkodbartTeckenError);
  });
});
