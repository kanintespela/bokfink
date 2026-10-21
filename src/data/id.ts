import { uuidv7, UUIDV7_RANDOM_BYTES, type Uuid } from '../domain/id/uuidv7';

/**
 * Mints the identifier every stored record carries.
 *
 * This is the layer that is allowed to read the clock and ask the platform
 * for randomness; the domain builds the identifier from what it is handed.
 */
export function newIdentifier(now: () => number = Date.now): Uuid {
  /*
   * Never the same millisecond twice, and never backwards. The log is folded
   * in identifier order, and one command often writes several entries in a
   * row - a receipt, the draft, the link between them - fast enough to share
   * a millisecond. After an equal timestamp only random bits decide the
   * order, and a replay that met the link before the receipt would stop.
   *
   * RFC 9562 section 6.2 allows keeping a UUIDv7 monotonic by advancing the
   * timestamp past the last one issued. It drifts by a millisecond for each
   * entry beyond the first in a millisecond, which is nothing next to what
   * a device clock drifts on its own.
   */
  senaste = Math.max(now(), senaste + 1);
  return uuidv7(senaste, randomBytes(UUIDV7_RANDOM_BYTES));
}

/** The timestamp of the last identifier this device issued. */
let senaste = 0;

function randomBytes(length: number): Uint8Array {
  /*
   * getRandomValues, unlike randomUUID and subtle, is available outside a
   * secure context - which is what a development build served over plain
   * http to a phone runs in.
   *
   * There is deliberately no Math.random() fallback. Hard rule 11: a browser
   * without a cryptographic generator has to say so, not quietly hand out
   * guessable identifiers that end up in bookkeeping records.
   */
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error(
      'Webbläsaren saknar en kryptografiskt säker slumpgenerator, så Kontera ' +
        'kan inte skapa identifierare. Uppdatera webbläsaren eller öppna appen ' +
        'över https.',
    );
  }

  return crypto.getRandomValues(new Uint8Array(length));
}
