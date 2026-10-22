import { franBase64, tillBase64 } from '../data/base64';
import type { Krypto } from '../data/synk';
import { dekryptera, harledNyckel, ITERATIONER, IV_BYTES, kryptera } from './krypto';

/**
 * The key the sync payloads are locked with.
 *
 * Derived from the passphrase with a fixed salt rather than a random one:
 * both devices have to arrive at the same key from the same words, and there
 * is nowhere to put a shared salt that the server would not also see. The
 * passphrase is the secret; the salt only has to be constant.
 *
 * `iterationer` is there for tests. Every device that syncs has to use the
 * default, or it derives a different key and reads nothing.
 */
export async function synkkrypto(
  losenfras: string,
  iterationer: number = ITERATIONER,
): Promise<Krypto> {
  const nyckel = await harledNyckel(losenfras, SYNKSALT, iterationer);
  return {
    kryptera: async (klartext) => {
      const { iv, chiffer } = await kryptera(nyckel, new TextEncoder().encode(klartext));
      return `${tillBase64(iv)}.${tillBase64(chiffer)}`;
    },
    dekryptera: async (text) => {
      const [iv, chiffer] = text.split('.');
      if (iv === undefined || chiffer === undefined) {
        throw new Error('En händelse från servern gick inte att läsa.');
      }
      return new TextDecoder().decode(
        await lasUpp(() => dekryptera(nyckel, franBase64(iv), franBase64(chiffer))),
      );
    },
    /*
     * Files travel as bytes rather than base64. A receipt is a couple of
     * megabytes and base64 would add a third to that on a phone connection,
     * for nothing: the nonce is simply written in front of the ciphertext,
     * which is how every AES-GCM envelope in this app is put together.
     */
    krypteraFil: async (data) => {
      const { iv, chiffer } = await kryptera(nyckel, data);
      const paket = new Uint8Array(iv.length + chiffer.length);
      paket.set(iv);
      paket.set(chiffer, iv.length);
      return paket;
    },
    dekrypteraFil: async (paket) =>
      lasUpp(() => dekryptera(nyckel, paket.slice(0, IV_BYTES), paket.slice(IV_BYTES))),
  };
}

/**
 * Decrypts, and says what a failure almost always means.
 *
 * AES-GCM cannot tell a wrong key from a damaged envelope, and Web Crypto
 * reports both as "The operation failed for an operation-specific reason" -
 * which tells nobody what to do. Between two devices of one owner the cause
 * is practically always a passphrase typed differently on one of them, so
 * that is what gets named (hard rule 11).
 */
async function lasUpp(dekryptering: () => Promise<Uint8Array>): Promise<Uint8Array> {
  try {
    return await dekryptering();
  } catch (orsak) {
    throw new Error(
      'Lösenfrasen stämmer inte med den som det här på servern är krypterat med. ' +
        'Kontrollera att samma lösenfras är inskriven på alla enheter.',
      { cause: orsak },
    );
  }
}

/** Constant, and not a secret. See synkkrypto. */
const SYNKSALT = new TextEncoder().encode('kontera-synk-v1.');
