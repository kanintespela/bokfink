import { describe, expect, it } from 'vitest';

import { foreslagenServer } from './serveradress';

describe('foreslagenServer', () => {
  it('offers the server beside the app on the tailnet', () => {
    expect(foreslagenServer({ protocol: 'https:', hostname: 'pi.tail1234.ts.net' })).toBe(
      'https://pi.tail1234.ts.net:8444',
    );
  });

  /* Anywhere else there is no telling where the server is. */
  it('offers nothing when the app was not loaded from a tailnet', () => {
    expect(foreslagenServer({ protocol: 'http:', hostname: 'localhost' })).toBe('');
    expect(foreslagenServer({ protocol: 'https:', hostname: 'bokfink.example' })).toBe(
      '',
    );
  });
});
