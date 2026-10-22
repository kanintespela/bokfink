import { describe, expect, it } from 'vitest';

import { klockslag, systemklocka } from './klocka';

describe('klockslag', () => {
  it('ger svensk tid som HHMMSS, också när enheten står på en annan zon', () => {
    // 2026-03-15 09:15:00 UTC is 10:15 in Stockholm (normal time, UTC+1).
    expect(klockslag(() => new Date('2026-03-15T09:15:00Z'))).toBe('101500');
    // Summer time, UTC+2.
    expect(klockslag(() => new Date('2026-07-01T22:05:09Z'))).toBe('000509');
  });

  it('hör ihop med samma dag som systemklockan', () => {
    const nu = () => new Date('2026-07-01T22:05:09Z');
    expect(systemklocka(nu).idag()).toBe('2026-07-02');
  });
});
