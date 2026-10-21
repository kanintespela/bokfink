import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../../domain/belopp/ore';
import { tolkaBelopp, visaBelopp } from './Beloppsfalt';

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
});
