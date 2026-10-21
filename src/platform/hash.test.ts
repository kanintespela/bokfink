import { describe, expect, it } from 'vitest';

import { hashaFil } from './hash';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('hashaFil', () => {
  /*
   * The two best-known SHA-256 values there are. If either of these ever
   * changes, the addresses of every stored file change with them.
   */
  it('hashes the known vectors', async () => {
    await expect(hashaFil(new Uint8Array(0))).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    await expect(hashaFil(bytes('abc'))).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes only the view, not the rest of its buffer', async () => {
    const buffert = bytes('xxabcxx');
    const utsnitt = new Uint8Array(buffert.buffer, 2, 3);
    await expect(hashaFil(utsnitt)).resolves.toBe(await hashaFil(bytes('abc')));
  });
});
