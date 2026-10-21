import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import { belopp, BOM, skrivCsv } from './csv';

const kr = (text: string) => oreFromKronor(text);

describe('skrivCsv', () => {
  /*
   * The three things a Swedish Excel needs, and each of them fails in its own
   * quiet way: without semicolons the file opens as one column, without a
   * decimal comma the amounts open as dates, and without the mark å and ä
   * arrive broken.
   */
  it('writes what a Swedish Excel can open', () => {
    const csv = skrivCsv([
      ['Konto', 'Namn', 'Belopp'],
      ['4010', 'Inköp av material och varor', belopp(kr('520.31'))],
    ]);

    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toContain('Konto;Namn;Belopp\r\n');
    expect(csv).toContain('4010;Inköp av material och varor;520,31\r\n');
  });

  it('writes a negative amount with its sign', () => {
    expect(skrivCsv([[belopp(kr('-1004.00'))]])).toContain('-1004,00');
  });

  it('writes an amount without a thousands separator', () => {
    // A space between the thousands is what a spreadsheet cannot read back.
    expect(skrivCsv([[belopp(kr('12345.67'))]])).toContain('12345,67');
  });

  it('quotes a field that contains the separator', () => {
    expect(skrivCsv([['Fakturan; och kvittot']])).toContain('"Fakturan; och kvittot"');
  });

  it('doubles the quotes inside a quoted field', () => {
    expect(skrivCsv([['Han sa "hej"; sedan gick han']])).toContain(
      '"Han sa ""hej""; sedan gick han"',
    );
  });

  it('quotes a field with a line break in it', () => {
    expect(skrivCsv([['två\nrader']])).toContain('"två\nrader"');
  });

  it('leaves an ordinary field bare, so the file stays readable', () => {
    expect(skrivCsv([['Programvara']])).toContain(';Programvara'.slice(1));
    expect(skrivCsv([['Programvara']])).not.toContain('"');
  });

  it('writes an empty cell as nothing at all', () => {
    expect(skrivCsv([['a', undefined, 'b']])).toContain('a;;b');
  });

  it('ends the last row too, which is what a reader expects', () => {
    expect(skrivCsv([['a']])).toBe(`${BOM}a\r\n`);
  });
});
