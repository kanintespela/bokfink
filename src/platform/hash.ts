import { sha256, type Sha256 } from '../domain/underlag/underlag';

/**
 * Hashes a file's bytes with SHA-256.
 *
 * Content addressing is what makes a receipt cost nothing to store twice, so
 * this runs on every file that is added. Web Crypto does it natively, which
 * matters on a phone: a hand-written implementation would be an order of
 * magnitude slower on a multi-megabyte photograph and would be our own
 * cryptography to maintain.
 */
export async function hashaFil(data: Uint8Array): Promise<Sha256> {
  const digest = await kravSubtle().digest('SHA-256', bufferAv(data));
  return sha256(
    [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(''),
  );
}

/**
 * Web Crypto exists only in a secure context.
 *
 * Served over plain http to a phone on the local network, crypto.subtle is
 * simply missing - the same trap crypto.randomUUID set in stage 1. Hard rule
 * 11 says that has to be visible rather than a confusing failure further in,
 * so it is named here, in the terms whoever hits it needs.
 */
function kravSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error(
      'Kontera kan inte beräkna kontrollsumman för filen, eftersom webbläsarens ' +
        'krypto-API bara finns när sidan är öppnad över https eller på localhost. ' +
        'Öppna appen över https och försök igen.',
    );
  }
  return subtle;
}

/** The exact bytes of the view, not whatever else shares its buffer. */
function bufferAv(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}
