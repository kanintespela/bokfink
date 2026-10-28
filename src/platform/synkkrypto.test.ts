import { describe, expect, it } from 'vitest';

import { franBase64 } from '../data/base64';
import { synkkrypto } from './synkkrypto';

const LOSENFRAS = 'korrekt häst batteri häftklammer';

describe('synkkrypto', () => {
  /*
   * Recorded once with the full iteration count. Every device that syncs has
   * to derive the same key from the same words and read the same envelope,
   * so a change to the salt, the count or the layout has to fail here rather
   * than on the day a phone and a second device stop understanding each
   * other.
   */
  it('reads an envelope written by an earlier build', async () => {
    const krypto = await synkkrypto(LOSENFRAS);

    expect(
      await krypto.dekryptera(
        's72FZZ5bV6qaxU3/.HCpjnzGXoFYtHPRiYQE/8Vvg6malvTgl+AdEKekBinGHb1dEr4o=',
      ),
    ).toBe('{"typ":"konto.skapat"}');
    expect(
      await krypto.dekrypteraFil(
        franBase64('LLIvVoqZz29tiuA2cIRBlCHHhs2gpmzAEbezWd1PEqE='),
      ),
    ).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));
  }, 30_000);

  it('gives back what went in, for entries and for files', async () => {
    const krypto = await synkkrypto(LOSENFRAS, 1000);
    const fil = new Uint8Array([1, 2, 3, 250]);

    expect(await krypto.dekryptera(await krypto.kryptera('Verifikat A1'))).toBe(
      'Verifikat A1',
    );
    expect(await krypto.dekrypteraFil(await krypto.krypteraFil(fil))).toEqual(fil);
  });

  it('cannot read what another passphrase wrote', async () => {
    const skrivare = await synkkrypto(LOSENFRAS, 1000);
    const lasare = await synkkrypto('en annan fras', 1000);

    await expect(lasare.dekryptera(await skrivare.kryptera('hemligt'))).rejects.toThrow(
      'Lösenfrasen stämmer inte',
    );
    await expect(
      lasare.dekrypteraFil(await skrivare.krypteraFil(new Uint8Array([1]))),
    ).rejects.toThrow('Lösenfrasen stämmer inte');
  });

  it('names an envelope that is not one', async () => {
    const krypto = await synkkrypto(LOSENFRAS, 1000);

    await expect(krypto.dekryptera('utan-punkt')).rejects.toThrow(
      'En händelse från servern gick inte att läsa.',
    );
  });

  /*
   * Decision X: without a passphrase the entries go as they are. What
   * matters is that both kinds of device read both kinds of entry, since a
   * server holds a mix while devices move from one to the other.
   */
  it('writes entries and files as they are without a passphrase', async () => {
    const krypto = await synkkrypto(undefined);
    const fil = new Uint8Array([1, 2, 3]);

    expect(await krypto.kryptera('{"typ":"konto.skapat"}')).toBe(
      '{"typ":"konto.skapat"}',
    );
    expect(await krypto.dekryptera('{"typ":"konto.skapat"}')).toBe(
      '{"typ":"konto.skapat"}',
    );
    expect(await krypto.krypteraFil(fil)).toBe(fil);
  });

  it('reads an entry written without a passphrase when it has one', async () => {
    const krypto = await synkkrypto(LOSENFRAS, 1000);

    expect(await krypto.dekryptera('{"typ":"konto.skapat"}')).toBe(
      '{"typ":"konto.skapat"}',
    );
  });

  it('asks for the passphrase when the server holds encrypted books', async () => {
    const lasare = await synkkrypto(undefined);
    const skrivare = await synkkrypto(LOSENFRAS, 1000);

    await expect(lasare.dekryptera(await skrivare.kryptera('{"a":1}'))).rejects.toThrow(
      'krypterad med en lösenfras',
    );
    await expect(
      lasare.dekrypteraFil(await skrivare.krypteraFil(new Uint8Array([1]))),
    ).rejects.toThrow('krypterad med en lösenfras');
  });
});
