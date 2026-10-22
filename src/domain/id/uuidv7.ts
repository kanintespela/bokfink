/**
 * A UUID in canonical lowercase hyphenated form.
 *
 * Branded so that an arbitrary string cannot stand in for an identifier that
 * something else generated and validated.
 */
export type Uuid = string & { readonly __brand: 'Uuid' };

/** Random bytes required by {@link uuidv7}. */
export const UUIDV7_RANDOM_BYTES = 10;

/** 48 bits of milliseconds, which runs out in the year 10889. */
const MAX_TIMESTAMP_MS = 2 ** 48 - 1;

/**
 * Builds a version 7 UUID: 48 bits of Unix milliseconds followed by 74 random
 * bits, laid out as RFC 9562 section 5.7 specifies.
 *
 * Kontera synchronises by merging append-only operation logs between devices
 * (docs/UTVECKLINGSPLAN.md, 3.1). Because the timestamp leads, identifiers
 * sort in creation order as plain strings, so a device can ask for everything
 * after the last id it saw instead of maintaining a sequence that two offline
 * devices would have to agree on.
 *
 * The platform's own crypto.randomUUID() is unusable for two separate
 * reasons: it produces version 4, which carries no timestamp and therefore
 * does not sort, and it is restricted to secure contexts, so it is missing
 * exactly when the app is served over plain http during development.
 *
 * The clock and the randomness are arguments rather than lookups, because
 * hard rule 3 keeps the domain layer deterministic and free of platform APIs.
 */
export function uuidv7(timestampMs: number, random: Uint8Array): Uuid {
  if (!Number.isInteger(timestampMs)) {
    throw new TypeError(`Tidsstämpeln måste vara ett heltal, fick ${timestampMs}.`);
  }
  if (timestampMs < 0 || timestampMs > MAX_TIMESTAMP_MS) {
    throw new RangeError(
      `Tidsstämpeln ${timestampMs} ligger utanför de 48 bitar en UUIDv7 rymmer.`,
    );
  }
  if (random.length < UUIDV7_RANDOM_BYTES) {
    throw new RangeError(
      `En UUIDv7 behöver ${UUIDV7_RANDOM_BYTES} slumpbytes, fick ${random.length}.`,
    );
  }

  const bytes = new Uint8Array(16);
  /*
   * Read and written through a DataView so every byte access is a plain
   * number. Indexing a Uint8Array yields `number | undefined` under
   * noUncheckedIndexedAccess, and silencing that with assertions would blunt
   * a flag this project turned on deliberately.
   */
  const view = new DataView(bytes.buffer);

  /*
   * Division rather than bit shifts: JavaScript's bitwise operators truncate
   * to 32 bits, and this timestamp needs 48.
   */
  for (let i = 0; i < 6; i += 1) {
    view.setUint8(5 - i, Math.floor(timestampMs / 2 ** (8 * i)) % 256);
  }

  bytes.set(random.subarray(0, UUIDV7_RANDOM_BYTES), 6);

  // Four version bits (0111) over the first random byte, then two variant
  // bits (10) two bytes later. Everything else stays as it came in.
  view.setUint8(6, 0x70 | (view.getUint8(6) & 0x0f));
  view.setUint8(8, 0x80 | (view.getUint8(8) & 0x3f));

  let out = '';
  for (let i = 0; i < 16; i += 1) {
    if (i === 4 || i === 6 || i === 8 || i === 10) {
      out += '-';
    }
    out += view.getUint8(i).toString(16).padStart(2, '0');
  }
  return out as Uuid;
}

/**
 * Reads back the millisecond timestamp a {@link uuidv7} identifier was built
 * from. Used by tests and by anything that needs an operation's age without
 * consulting a separate field.
 */
export function timestampOf(id: Uuid): number {
  const hex = id.replace(/-/g, '').slice(0, 12);
  return Number.parseInt(hex, 16);
}
