import { z } from 'zod';

import { franBase64, tillBase64 } from './base64';

/**
 * The envelope an encrypted backup travels in.
 *
 * A backup ends up somewhere Kontera does not control - iCloud, a hard disk,
 * an email to oneself - carrying a year of bookkeeping and every receipt
 * photograph. Encrypting it is what makes that acceptable.
 *
 * The envelope is JSON and readable: it says what it is, which algorithm was
 * used and with what parameters. Only the bookkeeping inside is unreadable.
 * That is deliberate - whoever finds this file in seven years has to be able
 * to tell what it is and what would open it, and hiding the format protects
 * nothing that the key does not already protect.
 */
export interface Krypteradkopia {
  readonly format: 'kontera-krypterad-sakerhetskopia';
  readonly formatversion: 1;
  readonly kdf: {
    readonly algoritm: 'PBKDF2-SHA256';
    readonly salt: string;
    readonly iterationer: number;
  };
  readonly chiffer: 'AES-GCM-256';
  /** The nonce, base64. Fresh for every file. */
  readonly iv: string;
  /** The backup itself, encrypted, base64. */
  readonly data: string;
  /** When it was made. Outside the encryption, so a folder can be sorted. */
  readonly skapad: string;
}

const kopia = z.object({
  format: z.literal('kontera-krypterad-sakerhetskopia'),
  formatversion: z.literal(1),
  kdf: z.object({
    algoritm: z.literal('PBKDF2-SHA256'),
    salt: z.string().min(1),
    iterationer: z.number().int().positive(),
  }),
  chiffer: z.literal('AES-GCM-256'),
  iv: z.string().min(1),
  data: z.string(),
  skapad: z.string(),
});

export class OlasbarKrypteradKopiaError extends Error {
  constructor(orsak: string) {
    super(`Filen går inte att läsa som en krypterad säkerhetskopia: ${orsak}`);
    this.name = 'OlasbarKrypteradKopiaError';
  }
}

/** True for a file that is one of these rather than a plain backup. */
export function arKrypterad(json: unknown): boolean {
  return (
    typeof json === 'object' &&
    json !== null &&
    (json as { format?: unknown }).format === 'kontera-krypterad-sakerhetskopia'
  );
}

export interface Paket {
  readonly salt: Uint8Array;
  readonly iterationer: number;
  readonly iv: Uint8Array;
  readonly chiffer: Uint8Array;
  readonly skapad: string;
}

/** Writes the envelope around an already encrypted backup. */
export function paketera(paket: Paket): string {
  const kopia: Krypteradkopia = {
    format: 'kontera-krypterad-sakerhetskopia',
    formatversion: 1,
    kdf: {
      algoritm: 'PBKDF2-SHA256',
      salt: tillBase64(paket.salt),
      iterationer: paket.iterationer,
    },
    chiffer: 'AES-GCM-256',
    iv: tillBase64(paket.iv),
    data: tillBase64(paket.chiffer),
    skapad: paket.skapad,
  };
  return `${JSON.stringify(kopia, undefined, 2)}\n`;
}

/**
 * Reads the envelope, or says what is wrong with it.
 *
 * Validated at the boundary like every other file this program reads, even
 * though this program wrote it: a backup is the one file the project promises
 * will still work when everything else has failed.
 */
export function laspaket(text: string): Paket {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new OlasbarKrypteradKopiaError('den innehåller inte giltig JSON.');
  }

  const resultat = kopia.safeParse(json);
  if (!resultat.success) {
    throw new OlasbarKrypteradKopiaError(
      resultat.error.issues[0]?.message ?? 'okänt fel',
    );
  }

  return {
    salt: franBase64(resultat.data.kdf.salt),
    iterationer: resultat.data.kdf.iterationer,
    iv: franBase64(resultat.data.iv),
    chiffer: franBase64(resultat.data.data),
    skapad: resultat.data.skapad,
  };
}
