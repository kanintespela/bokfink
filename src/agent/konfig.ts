import { z } from 'zod';

/**
 * What the assistant needs to reach the books: the sync server, a login to
 * it, and the passphrase the payloads are locked with.
 *
 * A file the owner writes by hand, never one the program creates or the
 * assistant fills in. The passphrase in it is the only thing standing
 * between the server and the bookkeeping, and it lies on the same machine as
 * the server - a trade-off the owner took knowingly on 2026-09-12, see
 * docs/UTVECKLINGSPLAN.md.
 */
const konfigschema = z.object({
  url: z.string().url(),
  epost: z.string().min(1),
  losenord: z.string().min(1),
  losenfras: z.string().min(1),
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
      `${sokvag} kan läsas av andra än du, och den innehåller synkens lösenfras. ` +
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
