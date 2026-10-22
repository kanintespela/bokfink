import { describe, expect, it } from 'vitest';

import { dekryptera, harledNyckel, kryptera, nyttSalt, slumpbytes } from './krypto';

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array) => new TextDecoder().decode(data);

// Deriving a key is deliberately slow, so the tests use one for all of them.
const salt = nyttSalt();
const nyckel = await harledNyckel('en ganska lång lösenfras', salt, 1000);

describe('kryptera och dekryptera', () => {
  it('gives back exactly what went in', async () => {
    const { iv, chiffer } = await kryptera(nyckel, bytes('Verifikat A1, 520,31 kr'));
    expect(text(await dekryptera(nyckel, iv, chiffer))).toBe('Verifikat A1, 520,31 kr');
  });

  it('handles the empty case, which a backup of nothing is', async () => {
    const { iv, chiffer } = await kryptera(nyckel, new Uint8Array(0));
    expect(await dekryptera(nyckel, iv, chiffer)).toEqual(new Uint8Array(0));
  });

  /*
   * A nonce may never be reused with the same key: two messages encrypted
   * under one nonce leak the difference between them. Fresh every time.
   */
  it('never encrypts twice with the same nonce', async () => {
    const forsta = await kryptera(nyckel, bytes('samma text'));
    const andra = await kryptera(nyckel, bytes('samma text'));

    expect(forsta.iv).not.toEqual(andra.iv);
    expect(forsta.chiffer).not.toEqual(andra.chiffer);
  });

  /*
   * AES-GCM authenticates as well as encrypts, which is the property that
   * makes a backup safe to hand to a cloud service: a changed byte is a
   * failure rather than quietly different bookkeeping.
   */
  it('refuses a file that has been changed', async () => {
    const { iv, chiffer } = await kryptera(nyckel, bytes('520,31'));
    const andrad = Uint8Array.from(chiffer);
    andrad[0] = (andrad[0]! ^ 1) as number;

    await expect(dekryptera(nyckel, iv, andrad)).rejects.toThrow();
  });

  it('refuses the wrong passphrase', async () => {
    const { iv, chiffer } = await kryptera(nyckel, bytes('520,31'));
    const fel = await harledNyckel('fel lösenfras', salt, 1000);

    await expect(dekryptera(fel, iv, chiffer)).rejects.toThrow();
  });

  /*
   * The salt is what stops one cracking effort from covering every backup.
   * Two files with the same passphrase must not share a key.
   */
  it('derives a different key from a different salt', async () => {
    const annat = await harledNyckel('en ganska lång lösenfras', nyttSalt(), 1000);
    const { iv, chiffer } = await kryptera(nyckel, bytes('520,31'));

    await expect(dekryptera(annat, iv, chiffer)).rejects.toThrow();
  });

  /*
   * An å can be one character or two - a plain a followed by a combining
   * ring - and a keyboard, a password manager and a paste from a note can
   * disagree about which. Normalising means the passphrase someone typed is
   * the passphrase they typed.
   */
  it('normalises the passphrase, so an å is an å however it was typed', async () => {
    const komponerad = await harledNyckel('\u00e5 l\u00f6senfras', salt, 1000);
    const dekomponerad = await harledNyckel('a\u030a lo\u0308senfras', salt, 1000);

    const { iv, chiffer } = await kryptera(komponerad, bytes('520,31'));
    expect(text(await dekryptera(dekomponerad, iv, chiffer))).toBe('520,31');
  });

  /*
   * What normalising does not do. A trailing space typed on one device and
   * not the other is invisible in a masked field, and unlike an å it is not
   * a question of Unicode form - the caller has to strip it before this
   * function ever sees the phrase. Synk.tsx does; this documents why it has
   * to, and what breaks silently if it stops.
   */
  it('does not trim the passphrase, so a stray space derives a different key', async () => {
    const ren = await harledNyckel('en delad lösenfras', salt, 1000);
    const medMellanslag = await harledNyckel('en delad lösenfras ', salt, 1000);

    const { iv, chiffer } = await kryptera(ren, bytes('520,31'));
    await expect(dekryptera(medMellanslag, iv, chiffer)).rejects.toThrow();
  });
});

describe('slumpbytes', () => {
  it('gives the number of bytes asked for', () => {
    expect(slumpbytes(16)).toHaveLength(16);
  });

  it('does not repeat itself', () => {
    expect(slumpbytes(16)).not.toEqual(slumpbytes(16));
  });
});
