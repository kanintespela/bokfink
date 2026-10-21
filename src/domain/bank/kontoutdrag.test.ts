import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import { lasKontoutdrag, OlasbartKontoutdragError } from './kontoutdrag';

const kr = (text: string) => oreFromKronor(text);

/*
 * The shape a Swedish bank exports: semicolons, a decimal comma, spaces for
 * thousands, and the newest transaction first.
 */
const SWEDBANK = `Radnummer;Clearingnummer;Kontonummer;Produkt;Valuta;Bokföringsdag;Transaktionsdag;Valutadag;Referens;Beskrivning;Belopp;Bokfört saldo
1;8327-9;123 456 789-0;Företagskonto;SEK;2026-02-14;2026-02-13;2026-02-14;Kortköp;BYGGHANDEL EXEMPEL;-520,31;12 345,67
2;8327-9;123 456 789-0;Företagskonto;SEK;2026-02-10;2026-02-10;2026-02-10;Inbetalning;FAKTURA 4417;12 645,00;12 865,98
`;

describe('lasKontoutdrag', () => {
  it('reads a Swedish bank export', () => {
    const rader = lasKontoutdrag(SWEDBANK);

    expect(rader).toHaveLength(2);
    // Oldest first, whatever order the bank exported them in.
    expect(rader[0]?.datum).toBe('2026-02-10');
    expect(rader[0]?.belopp).toBe(kr('12645.00'));
    expect(rader[1]?.belopp).toBe(kr('-520.31'));
    expect(rader[1]?.saldo).toBe(kr('12345.67'));
  });

  it('takes the text column even when the bank calls it something else', () => {
    expect(lasKontoutdrag(SWEDBANK)[1]?.text).toBe('BYGGHANDEL EXEMPEL');
  });

  it('reads a comma-separated file with dots for decimals', () => {
    const text = 'Datum,Text,Belopp\n2026-02-13,Kortköp,-520.31\n';
    expect(lasKontoutdrag(text)[0]?.belopp).toBe(kr('-520.31'));
  });

  it('reads a tab-separated file', () => {
    const text = 'Datum\tText\tBelopp\n2026-02-13\tKortköp\t-520,31\n';
    expect(lasKontoutdrag(text)[0]?.belopp).toBe(kr('-520.31'));
  });

  it('keeps a quoted separator inside the text', () => {
    const text = 'Datum;Text;Belopp\n2026-02-13;"Kortköp, Ekeby";-520,31\n';
    expect(lasKontoutdrag(text)[0]?.text).toBe('Kortköp, Ekeby');
  });

  it('skips the account details some banks put above the header', () => {
    const text = `Kontonummer;123 456 789-0
Period;2026-02-01 - 2026-02-28

Datum;Text;Belopp
2026-02-13;Kortköp;-520,31
`;
    expect(lasKontoutdrag(text)).toHaveLength(1);
  });

  it('reads a trailing minus, which some exports use', () => {
    const text = 'Datum;Text;Belopp\n2026-02-13;Kortköp;520,31-\n';
    expect(lasKontoutdrag(text)[0]?.belopp).toBe(kr('-520.31'));
  });

  it('reads the six-digit date older files still carry', () => {
    const text = 'Datum;Text;Belopp\n260213;Kortköp;-520,31\n';
    expect(lasKontoutdrag(text)[0]?.datum).toBe('2026-02-13');
  });

  it('ignores a summary row with no amount', () => {
    const text = `Datum;Text;Belopp
2026-02-13;Kortköp;-520,31
;Summa;
`;
    expect(lasKontoutdrag(text)).toHaveLength(1);
  });

  /*
   * Hard rule 11. A file whose columns are not recognised has to say so and
   * name what it was looking for, rather than import nothing and look like
   * an empty month.
   */
  it('refuses a file whose columns it does not recognise', () => {
    expect(() => lasKontoutdrag('a;b;c\n1;2;3\n')).toThrow(OlasbartKontoutdragError);
    expect(() => lasKontoutdrag('a;b;c\n1;2;3\n')).toThrow(/datum, text och belopp/);
  });

  it('refuses an empty file', () => {
    expect(() => lasKontoutdrag('')).toThrow(OlasbartKontoutdragError);
    expect(() => lasKontoutdrag('   \n\n')).toThrow(OlasbartKontoutdragError);
  });

  it('refuses a file with headers but nothing under them', () => {
    expect(() => lasKontoutdrag('Datum;Text;Belopp\n')).toThrow(/inga transaktioner/);
  });
});
