import { describe, expect, it } from 'vitest';

import { laseSie, SiesyntaxError } from './lexer';

describe('laseSie', () => {
  it('splits a record into label and fields', () => {
    const [post] = laseSie('#KONTO 1150 "Markanläggningar"');
    expect(post).toEqual({
      etikett: 'KONTO',
      falt: ['1150', 'Markanläggningar'],
      rad: 1,
      niva: 0,
    });
  });

  it('keeps an empty quoted field, which #ADRESS uses', () => {
    const [post] = laseSie('#ADRESS "" "Östingstorp 141" "39598 LÄCKEBY" ""');
    expect(post?.falt).toEqual(['', 'Östingstorp 141', '39598 LÄCKEBY', '']);
  });

  it('keeps the dimension group as one field', () => {
    const [post] = laseSie('#TRANS 2013 {} -520.31 20260109 "" 0.0');
    expect(post?.falt).toEqual(['2013', '{}', '-520.31', '20260109', '', '0.0']);
  });

  it('handles a dimension group with contents', () => {
    const [post] = laseSie('#TRANS 4010 {1 "500" 6 "Projekt"} 100.00');
    expect(post?.falt[1]).toBe('{1 "500" 6 "Projekt"}');
  });

  it('tracks how deep inside a verifikat a record sits', () => {
    const poster = laseSie(
      [
        '#VER "A" 2 20260109 "Inköp av mineralfoder" 20260112 ""',
        '{',
        '#TRANS 2013 {} -520.31',
        '#TRANS 4010 {} 416.25',
        '}',
        '#VER "A" 3 20260113 "Momsutbetalning" 20260114 ""',
      ].join('\n'),
    );

    expect(poster.map((p) => [p.etikett, p.niva])).toEqual([
      ['VER', 0],
      ['TRANS', 1],
      ['TRANS', 1],
      ['VER', 0],
    ]);
  });

  it('unescapes a quotation mark inside a description', () => {
    const [post] = laseSie('#VER "A" 1 20260101 "Faktura \\"9\\"" 20260101 ""');
    expect(post?.falt[3]).toBe('Faktura "9"');
  });

  it('reads all three line endings', () => {
    for (const brytning of ['\n', '\r\n', '\r']) {
      expect(laseSie(`#FLAGGA 0${brytning}#SIETYP 4`).map((p) => p.etikett)).toEqual([
        'FLAGGA',
        'SIETYP',
      ]);
    }
  });

  it('reads a file with no trailing newline, as the export produces', () => {
    // Real export files can end on the closing brace of the last verifikat, with
    // no newline after it.
    const text = '#VER "A" 1 20260101 "x"\n{\n#TRANS 1930 {} 1.00\n}';
    expect(laseSie(text).map((p) => p.etikett)).toEqual(['VER', 'TRANS']);
  });

  /*
   * Kept rather than dropped. A SIE file carries sections this program has no
   * use for, and a reader that discarded them silently would make an export
   * that quietly lost data look like a clean round trip.
   */
  it('keeps records it does not recognise', () => {
    const [post] = laseSie('#PROGRAM "Exempelbok" "2026-09-04"');
    expect(post?.etikett).toBe('PROGRAM');
    expect(post?.falt).toEqual(['Exempelbok', '2026-09-04']);
  });

  it('ignores blank lines but keeps counting them', () => {
    const poster = laseSie('#FLAGGA 0\n\n\n#SIETYP 4');
    expect(poster[1]?.rad).toBe(4);
  });

  it('refuses an unterminated quote', () => {
    expect(() => laseSie('#KONTO 1930 "Företagskonto')).toThrow(SiesyntaxError);
  });

  it('refuses a stray closing brace', () => {
    expect(() => laseSie('}')).toThrow(SiesyntaxError);
  });

  it('refuses a file that ends inside a verifikat', () => {
    expect(() => laseSie('#VER "A" 1 20260101 "x"\n{\n#TRANS 1930 {} 1.00')).toThrow(
      /oavslutad/,
    );
  });

  it('refuses a line that is not a record', () => {
    expect(() => laseSie('bara text')).toThrow(SiesyntaxError);
  });

  it('points at the line that failed', () => {
    expect(() => laseSie('#FLAGGA 0\n#SIETYP 4\nskräp')).toThrow(/Rad 3/);
  });
});
