/**
 * Which build this is: the commit it was made from and the day it was made.
 *
 * Shown under Status, because the app updates itself from CI and closing it
 * is enough to take a waiting version into use - without this, nothing on
 * the phone says whether that has happened.
 *
 * Filled in by Vite's `define` at build time (vite.config.ts).
 */
declare const __KONTERA_COMMIT__: string;
declare const __KONTERA_BYGGD__: string;

export const byggversion = {
  commit: __KONTERA_COMMIT__,
  byggd: __KONTERA_BYGGD__,
} as const;
