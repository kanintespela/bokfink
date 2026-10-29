import { z } from 'zod';

/**
 * What the assistant needs to reach the books: the sync server, a login to
 * it, and - if the books sync encrypted - the passphrase.
 *
 * A file the owner writes by hand, never one the program creates or the
 * assistant fills in. The passphrase, where there is one, lies on the same
 * machine as the server - a trade-off the owner took knowingly on
 * 2026-09-12, and which led to the passphrase becoming optional on
 * 2026-10-28 (decisions N and X in docs/UTVECKLINGSPLAN.md). Without it the
 * assistant sends its drafts unencrypted, like a device without one.
 */
const konfigschema = z.object({
  url: z.string().url(),
  epost: z.string().min(1),
  losenord: z.string().min(1),
  losenfras: z.string().min(1).optional(),
  /** Written on every entry as the device it came from. */
  enhet: z.string().min(1).default('claude-pi'),
});

export type Agentkonfig = z.infer<typeof konfigschema>;

export interface Konfigfil {
  /** Permission bits, as stat reports them. */
  readonly lage: number;
  readonly text: string;
}

/**
 * Reads the file, and refuses one others can read.
 *
 * The same rule ssh applies to a private key, for the same reason: a
 * passphrase readable by every account on the machine is not a secret, and
 * failing loudly is the only way anyone finds out before it matters.
 */
export function tolkaKonfig(sokvag: string, fil: Konfigfil): Agentkonfig {
  if ((fil.lage & 0o077) !== 0) {
    throw new Error(
      `${sokvag} kan läsas av andra än du, och den innehåller lösenordet till ` +
        'synkservern. ' +
        `Kör chmod 600 ${sokvag} och försök igen.`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(fil.text);
  } catch {
    throw new Error(`${sokvag} är inte giltig JSON.`);
  }

  const tolkat = konfigschema.safeParse(json);
  if (!tolkat.success) {
    throw new Error(
      `${sokvag} saknar eller har fel på: ${tolkat.error.issues
        .map((fel) => fel.path.join('.'))
        .join(', ')}.`,
    );
  }
  return tolkat.data;
}

/**
 * The receipt watcher's settings (beslut Y), in a file of their own.
 *
 * Apart from agent.json because they hold no secret and are meant to be
 * edited - the start day, the limits, where the news goes - and a file with
 * the login in it is one to open as rarely as possible. Without this file
 * las-nya refuses to start, and nothing is sent anywhere.
 */
const vaktschema = z.object({
  /** Only receipts added on or after this day, YYYY-MM-DD. */
  fran: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fran ska vara ett datum, ÅÅÅÅ-MM-DD'),
  maxPerKorning: z.number().int().positive().default(3),
  maxPerDygn: z.number().int().positive().default(20),
  /** Where Hermes sends the news, e.g. "discord"; none when left out. */
  avisering: z.string().min(1).optional(),
  /** The Hermes command, if it is not on the PATH. */
  hermes: z.string().min(1).default('hermes'),
  /**
   * The firm's or owner's name as it stands on invoices to it. Without it
   * the reader cannot tell a supplier's invoice to the firm from one the
   * firm wrote, and on 2026-10-29 it took a purchase of barley for a sale.
   */
  foretag: z.string().min(1).optional(),
  /** Decides the date an invoice is booked on, and whether 1510 and 2440 belong. */
  redovisningsmetod: z
    .enum(['kontantmetoden', 'faktureringsmetoden'])
    .default('kontantmetoden'),
});

export type Vaktkonfig = z.infer<typeof vaktschema>;

export function tolkaVaktkonfig(sokvag: string, text: string): Vaktkonfig {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${sokvag} är inte giltig JSON.`);
  }
  const tolkat = vaktschema.safeParse(json);
  if (!tolkat.success) {
    throw new Error(
      `${sokvag} har fel på: ${tolkat.error.issues
        .map((fel) => `${fel.path.join('.')} (${fel.message})`)
        .join(', ')}.`,
    );
  }
  return tolkat.data;
}
