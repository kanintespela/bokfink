import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../../domain/belopp/ore';
import { beloppshjalp, tolkaBelopp, visaBelopp } from './Beloppsfalt';

describe('tolkaBelopp', () => {
  it('reads what someone types on a Swedish keyboard', () => {
    expect(tolkaBelopp('520,31')).toBe(oreFromKronor('520.31'));
    expect(tolkaBelopp('520.31')).toBe(oreFromKronor('520.31'));
    expect(tolkaBelopp('520')).toBe(oreFromKronor('520.00'));
    expect(tolkaBelopp('1 250,00')).toBe(oreFromKronor('1250.00'));
  });

  /*
   * A half-written amount is a state the field lives in, not an error. The
   * button stays disabled until it parses, and nothing turns red while
   * someone is still typing.
   */
  it('gives nothing back while the amount is still being typed', () => {
    for (const halvvags of ['', '  ', '12,', ',', '-']) {
      expect(tolkaBelopp(halvvags)).toBeUndefined();
    }
  });

  it('gives nothing back for something that is not an amount', () => {
    expect(tolkaBelopp('tolv')).toBeUndefined();
    expect(tolkaBelopp('12,345')).toBeUndefined();
  });

  it('formats an amount with the unit', () => {
    expect(visaBelopp(oreFromKronor('520.31'))).toBe('520,31 kr');
    expect(visaBelopp(oreFromKronor('-1234.56'))).toBe('-1 234,56 kr');
  });

  /*
   * A figure of a size nobody books in an enskild firma is a slip of the
   * finger. Accepted, it made every report of the year unreadable.
   */
  it('refuses an amount of a billion kronor or more', () => {
    expect(tolkaBelopp('999 999 999,99')).toBe(oreFromKronor('999999999.99'));
    expect(tolkaBelopp('1000000000')).toBeUndefined();
    expect(tolkaBelopp('99999999999,99')).toBeUndefined();
  });
});

describe('beloppshjalp', () => {
  it('says nothing about an amount that reads, or that is still being typed', () => {
    for (const ok of ['', '520,31', '1 250,00', '-50', '12,', ',', '-', '1234.56']) {
      expect(beloppshjalp(ok)).toBeUndefined();
    }
  });

  it('explains a dot used for thousands', () => {
    expect(beloppshjalp('1.234,56')).toMatch(/tusental/);
  });

  it('explains more than two decimals', () => {
    expect(beloppshjalp('10,005')).toMatch(/två decimaler/);
  });

  it('explains an amount that is too large', () => {
    expect(beloppshjalp('99999999999,99')).toMatch(/för stort/);
  });

  it('explains anything else that is not an amount', () => {
    expect(beloppshjalp('abc')).toMatch(/siffror/);
    expect(beloppshjalp('1e3')).toMatch(/siffror/);
  });
});
