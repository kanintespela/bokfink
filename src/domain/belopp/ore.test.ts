import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  add,
  delaOchAvrunda,
  formatKronor,
  isZero,
  kronorString,
  negate,
  ore,
  oreFromKronor,
  subtract,
  sum,
  ZERO,
  type Ore,
} from './ore';

/** Amounts within a range a sole trader's books plausibly reach. */
const arbOre = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }).map(ore);

describe('oreFromKronor', () => {
  it('reads the amounts that appear in a real SIE file', () => {
    // Shaped like a real SIE file: opening balance, a VAT line, a whole
    // krona amount, and a negative equity balance.
    expect(oreFromKronor('52418.37')).toBe(5241837);
    expect(oreFromKronor('6431.25')).toBe(643125);
    expect(oreFromKronor('150000.00')).toBe(15000000);
    expect(oreFromKronor('-312906.48')).toBe(-31290648);
  });

  it('accepts a comma, as a Swedish input field produces', () => {
    expect(oreFromKronor('1234,56')).toBe(123456);
    expect(oreFromKronor('-0,05')).toBe(-5);
  });

  it('accepts one decimal, or none at all', () => {
    expect(oreFromKronor('12.5')).toBe(1250);
    expect(oreFromKronor('12')).toBe(1200);
  });

  it('never produces negative zero', () => {
    expect(Object.is(oreFromKronor('-0.00'), 0)).toBe(true);
    expect(Object.is(oreFromKronor('-0'), 0)).toBe(true);
  });

  it('refuses anything that is not a plain decimal amount', () => {
    for (const bad of ['', ' ', 'abc', '1.234', '1 234', '1.2.3', '1,', '--1', '1e3']) {
      expect(() => oreFromKronor(bad)).toThrow(TypeError);
    }
  });
});

describe('the float trap', () => {
  it('adds tenths exactly, where floating point does not', () => {
    // 0.1 + 0.2 === 0.30000000000000004 as floats. This is the whole reason
    // the type exists, so it is asserted rather than assumed.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(add(oreFromKronor('0.10'), oreFromKronor('0.20'))).toBe(oreFromKronor('0.30'));
  });

  it('sums a hundred öre-sized amounts without drift', () => {
    const amounts = Array.from({ length: 100 }, () => oreFromKronor('0.07'));
    expect(sum(amounts)).toBe(oreFromKronor('7.00'));
  });
});

describe('round trips', () => {
  it('survives kronorString and back', () => {
    fc.assert(
      fc.property(arbOre, (amount) => {
        expect(oreFromKronor(kronorString(amount))).toBe(amount);
      }),
    );
  });

  it('always writes exactly two decimals', () => {
    fc.assert(
      fc.property(arbOre, (amount) => {
        expect(kronorString(amount)).toMatch(/^-?\d+\.\d{2}$/);
      }),
    );
  });

  it('writes the amounts a SIE file expects', () => {
    expect(kronorString(ore(5241837))).toBe('52418.37');
    expect(kronorString(ore(-31290648))).toBe('-312906.48');
    expect(kronorString(ore(5))).toBe('0.05');
    expect(kronorString(ZERO)).toBe('0.00');
  });
});

describe('arithmetic', () => {
  it('is commutative', () => {
    fc.assert(
      fc.property(arbOre, arbOre, (a, b) => {
        expect(add(a, b)).toBe(add(b, a));
      }),
    );
  });

  it('is associative', () => {
    fc.assert(
      fc.property(arbOre, arbOre, arbOre, (a, b, c) => {
        expect(add(add(a, b), c)).toBe(add(a, add(b, c)));
      }),
    );
  });

  it('cancels against its own negation', () => {
    fc.assert(
      fc.property(arbOre, (amount) => {
        expect(isZero(add(amount, negate(amount)))).toBe(true);
        expect(subtract(amount, amount)).toBe(ZERO);
      }),
    );
  });

  it('agrees with folding add, which is what the balance check relies on', () => {
    fc.assert(
      fc.property(fc.array(arbOre, { maxLength: 40 }), (amounts) => {
        expect(sum(amounts)).toBe(amounts.reduce(add, ZERO));
      }),
    );
  });

  it('sums an empty run to zero', () => {
    expect(sum([])).toBe(ZERO);
  });
});

describe('guards', () => {
  it('refuses a fractional öre', () => {
    expect(() => ore(1.5)).toThrow(TypeError);
    expect(() => ore(Number.NaN)).toThrow(TypeError);
    expect(() => ore(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it('refuses amounts too large to add exactly', () => {
    expect(() => ore(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
    const huge = ore(Number.MAX_SAFE_INTEGER);
    expect(() => add(huge, huge)).toThrow(RangeError);
    expect(() => oreFromKronor('99999999999999999.99')).toThrow(RangeError);
  });
});

describe('formatKronor', () => {
  it('groups thousands and uses a decimal comma', () => {
    expect(formatKronor(ore(123456))).toBe('1\u00a0234,56');
    expect(formatKronor(ore(15000000))).toBe('150\u00a0000,00');
    expect(formatKronor(ore(-31290648))).toBe('-312\u00a0906,48');
  });

  it('leaves amounts under a thousand ungrouped', () => {
    expect(formatKronor(ore(5))).toBe('0,05');
    expect(formatKronor(ore(99999))).toBe('999,99');
    expect(formatKronor(ZERO)).toBe('0,00');
  });

  it('keeps every digit of the amount', () => {
    fc.assert(
      fc.property(arbOre, (amount: Ore) => {
        const digits = formatKronor(amount).replace(/[\s,-]/g, '');
        expect(digits).toBe(kronorString(amount).replace(/[.-]/g, ''));
      }),
    );
  });
});

describe('negate', () => {
  it('turns an amount around', () => {
    expect(negate(oreFromKronor('520.31'))).toBe(oreFromKronor('-520.31'));
    expect(negate(oreFromKronor('-520.31'))).toBe(oreFromKronor('520.31'));
  });

  /*
   * Zero has no other side. Without this, negating it produces -0, which
   * compares equal to 0 everywhere except Object.is - and serialises as "-0"
   * in JSON, which is what would reach an export file. Found by a report
   * whose empty months came out as "-0,00 kr".
   */
  it('leaves zero as zero, not as minus zero', () => {
    expect(Object.is(negate(ZERO), ZERO)).toBe(true);
    expect(JSON.stringify(negate(ZERO))).toBe('0');
  });
});

describe('delaOchAvrunda', () => {
  it('rounds to the nearest öre', () => {
    expect(delaOchAvrunda(10, 4)).toBe(ore(3)); // 2.5, halves away from zero
    expect(delaOchAvrunda(9, 4)).toBe(ore(2)); // 2.25
    expect(delaOchAvrunda(11, 4)).toBe(ore(3)); // 2.75
  });

  it('rounds halves away from zero regardless of sign', () => {
    expect(delaOchAvrunda(-10, 4)).toBe(ore(-3));
  });

  it('refuses an amount too large to divide exactly', () => {
    expect(() => delaOchAvrunda(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
  });
});
