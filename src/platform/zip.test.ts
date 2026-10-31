import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { ZipFel } from '../domain/arkiv/zipLasare';
import { inflateRaw } from './zip';

describe('inflateRaw', () => {
  it('gives back what was deflated', async () => {
    const text = new TextEncoder().encode('#FLAGGA 0\r\n'.repeat(500));
    const ut = await inflateRaw(new Uint8Array(deflateRawSync(text)), text.length);
    expect(ut).toEqual(text);
  });

  it('stops a stream that holds more than it was said to, before collecting it', async () => {
    const stor = new Uint8Array(5_000_000).fill(65);
    await expect(
      inflateRaw(new Uint8Array(deflateRawSync(stor)), 1000),
    ).rejects.toBeInstanceOf(ZipFel);
  });

  it('refuses data that is not a deflate stream', async () => {
    await expect(inflateRaw(new Uint8Array([1, 2, 3, 4, 5, 6]), 100)).rejects.toThrow();
  });
});
