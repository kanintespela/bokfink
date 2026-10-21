import { describe, expect, it } from 'vitest';

import { avkodaText } from './fil';

describe('avkodaText', () => {
  it('reads UTF-8', () => {
    const bytes = new TextEncoder().encode('Kortköp på Åhléns');
    expect(avkodaText(bytes)).toBe('Kortköp på Åhléns');
  });

  /*
   * The older bank exports. "Kortköp" in windows-1252 is not valid UTF-8, so
   * the strict decode fails and says so instead of producing "Kortkï¿½p".
   */
  it('falls back to windows-1252', () => {
    // K o r t k ö p, with ö as the single byte 0xF6.
    const bytes = new Uint8Array([0x4b, 0x6f, 0x72, 0x74, 0x6b, 0xf6, 0x70]);
    expect(avkodaText(bytes)).toBe('Kortköp');
  });

  it('reads an empty file as an empty string', () => {
    expect(avkodaText(new Uint8Array(0))).toBe('');
  });
});
