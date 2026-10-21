import type { Datum } from './datum';

/**
 * The current date, as a dependency.
 *
 * Hard rule 3 keeps the clock out of the domain: a report run at midnight has
 * to match one run at noon, and a test must not change its answer with the
 * calendar. Everything that needs today takes one of these instead of reading
 * the system clock, and the implementation that resolves "now" in
 * Europe/Stockholm lives in a layer that is allowed to look.
 */
export interface Klocka {
  idag(): Datum;
}

/** A clock frozen at one date, for tests and for previewing a given day. */
export function fastKlocka(fixed: Datum): Klocka {
  return { idag: () => fixed };
}
