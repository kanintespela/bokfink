import { describe, expect, it } from 'vitest';

import { newIdentifier } from './id';

describe('newIdentifier', () => {
  /*
   * The log is folded in identifier order, and a command often writes several
   * entries in a row - a receipt, then the draft, then the link between them.
   * On a fast device those land in the same millisecond, and with 74 random
   * bits after an equal timestamp their order was a coin toss: a device
   * replaying the log could meet the link before the receipt and stop.
   */
  it('sorts in the order it was called, even within one millisecond', () => {
    const nu = () => 1_789_000_000_000;
    const idn = Array.from({ length: 2000 }, () => newIdentifier(nu));

    expect([...idn].sort()).toEqual(idn);
    expect(new Set(idn).size).toBe(idn.length);
  });

  it('keeps sorting forwards when the clock steps back', () => {
    let klocka = 1_789_000_000_500;
    const forsta = newIdentifier(() => klocka);
    klocka -= 400;
    const andra = newIdentifier(() => klocka);

    expect(andra > forsta).toBe(true);
  });

  it('still carries the time it was made when the clock moves normally', () => {
    const id = newIdentifier(() => Date.UTC(2031, 0, 1));
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBeGreaterThanOrEqual(
      Date.UTC(2031, 0, 1),
    );
  });
});
