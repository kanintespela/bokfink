import { afterEach, describe, expect, it, vi } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { hamtaPrisbasbelopp } from './scb';

function svararMed(status: number, kropp: unknown) {
  const anrop = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify(kropp), { status }),
  );
  vi.stubGlobal('fetch', anrop);
  return anrop;
}

describe('hamtaPrisbasbelopp', () => {
  afterEach(() => vi.unstubAllGlobals());

  // The answer SCB gave on 2026-09-13 for 2027, trimmed to what is read.
  it('reads the year out of the table and asks for nothing else', async () => {
    const anrop = svararMed(200, {
      columns: [{ code: 'Tid' }, { code: 'PR0101A1' }],
      data: [{ key: ['2027'], values: ['59600'] }],
    });

    expect(await hamtaPrisbasbelopp(2027)).toBe(oreFromKronor('59600'));
    const skickat = JSON.parse(String(anrop.mock.calls[0]![1]!.body)) as unknown;
    expect(JSON.stringify(skickat)).not.toMatch(/[^\w":{}[\],.]/);
    expect(JSON.stringify(skickat)).toContain('"2027"');
  });

  it('says so when SCB does not have the year yet', async () => {
    svararMed(400, { error: 'unknown value' });
    await expect(hamtaPrisbasbelopp(2031)).rejects.toThrow(
      'inget prisbasbelopp för 2031',
    );
  });

  it('says so when there is no network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(hamtaPrisbasbelopp(2027)).rejects.toThrow('SCB svarar inte');
  });
});
