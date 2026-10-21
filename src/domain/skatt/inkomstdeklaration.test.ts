import { describe, expect, it } from 'vitest';

import { sistaDagForInkomstdeklaration } from './inkomstdeklaration';

describe('sistaDagForInkomstdeklaration', () => {
  it('is 2 May the year after when that is a vardag', () => {
    // Tuesday 2 May 2028.
    expect(sistaDagForInkomstdeklaration(2027)).toBe('2028-05-02');
  });

  it('moves off a weekend', () => {
    // 2 May 2026 is a Saturday, 2 May 2027 a Sunday.
    expect(sistaDagForInkomstdeklaration(2025)).toBe('2026-05-04');
    expect(sistaDagForInkomstdeklaration(2026)).toBe('2027-05-03');
  });
});
