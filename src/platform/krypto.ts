/**
 * Encryption for the things that leave the device.
 *
 * Web Crypto only: AES-GCM for the data and PBKDF2 for turning a passphrase
 * into a key. Both are in every browser Kontera targets, reviewed by people
 * who do this for a living, and hardware-accelerated - which matters when a
 * backup carries a year of receipt photographs.
 *
 * Argon2id would be the better key derivation and is not available natively;
 * adding it means shipping a WASM implementation and making our own choice of
 * parameters. PBKDF2 with a high enough count is what the platform gives, and
 * the plan allows either (docs/UTVECKLINGSPLAN.md, section 2).
 */

/**
 * How many rounds a passphrase is put through.
 *
 * OWASP's recommendation for PBKDF2-HMAC-SHA256 is 600 000, which takes
 * something under a second on a phone - slow enough to be worth an attacker's
 * trouble, fast enough that unlocking does not feel broken. Stored in the
 * file rather than assumed, so the number can be raised later without making
 * old backups unreadable.
 */
export const ITERATIONER = 600_000;

/** AES-GCM's nonce is 96 bits, which is what the standard is defined for. */
export const IV_BYTES = 12;

/** 128 bits of salt, so two backups never derive the same key. */
const SALT_BYTES = 16;

export interface Krypterat {
  readonly iv: Uint8Array;
  readonly chiffer: Uint8Array;
}

/** Random bytes from the platform's own generator. */
export function slumpbytes(antal: number): Uint8Array {
  const bytes = new Uint8Array(antal);
  kravCrypto().getRandomValues(bytes);
  return bytes;
}

export const nyttSalt = (): Uint8Array => slumpbytes(SALT_BYTES);

/**
 * Turns a passphrase into a key.
 *
 * The salt and the count travel with the file, so a key can always be derived
 * again from the passphrase alone - which is the whole point of a passphrase
 * as a recovery route: it works on a device that has never seen this data.
 */
export async function harledNyckel(
  losenfras: string,
  salt: Uint8Array,
  iterationer: number = ITERATIONER,
): Promise<CryptoKey> {
  const subtle = kravSubtle();
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(losenfras.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return subtle.deriveKey(
    { name: 'PBKDF2', salt: bufferAv(salt), iterations: iterationer, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypts, with a fresh nonce every time. Reusing one would leak the data. */
export async function kryptera(
  nyckel: CryptoKey,
  klartext: Uint8Array,
): Promise<Krypterat> {
  const iv = slumpbytes(IV_BYTES);
  const chiffer = await kravSubtle().encrypt(
    { name: 'AES-GCM', iv: bufferAv(iv) },
    nyckel,
    bufferAv(klartext),
  );
  return { iv, chiffer: new Uint8Array(chiffer) };
}

/**
 * Decrypts, or throws.
 *
 * AES-GCM authenticates as well as encrypts, so a wrong passphrase and a
 * damaged file fail the same way: the tag does not match and nothing is
 * returned. That is the property that makes it safe to hand a backup to a
 * cloud service - a changed byte is a failure, not a quietly different
 * bookkeeping.
 */
export async function dekryptera(
  nyckel: CryptoKey,
  iv: Uint8Array,
  chiffer: Uint8Array,
): Promise<Uint8Array> {
  const klartext = await kravSubtle().decrypt(
    { name: 'AES-GCM', iv: bufferAv(iv) },
    nyckel,
    bufferAv(chiffer),
  );
  return new Uint8Array(klartext);
}

function kravCrypto(): Crypto {
  const krypto = globalThis.crypto;
  if (krypto === undefined) {
    throw new Error(
      'Webbläsarens krypto-API saknas, så säkerhetskopian kan inte krypteras. ' +
        'Öppna appen över https och försök igen.',
    );
  }
  return krypto;
}

function kravSubtle(): SubtleCrypto {
  const subtle = kravCrypto().subtle;
  if (subtle === undefined) {
    // The same secure-context trap as hashing and crypto.randomUUID.
    throw new Error(
      'Webbläsarens krypto-API finns bara när sidan öppnas över https eller på ' +
        'localhost. Öppna appen över https och försök igen.',
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
