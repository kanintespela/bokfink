import { describe, expect, it } from 'vitest';

import { skaSynkas, vantetidEfterFel, type Synklage } from './autosynk';

const lage = (overstyr: Partial<Synklage> = {}): Synklage => ({
  aktiv: true,
  online: true,
  pagar: false,
  osankta: 0,
  anledning: 'start',
  ...overstyr,
});

describe('skaSynkas', () => {
  /*
   * The three reasons that are about the other device. An empty queue says
   * nothing about what it booked, so asking is the whole point.
   */
  it('asks the server whenever the app or the network comes back', () => {
    expect(skaSynkas(lage({ anledning: 'start' }))).toBe(true);
    expect(skaSynkas(lage({ anledning: 'synlig' }))).toBe(true);
    expect(skaSynkas(lage({ anledning: 'natet-tillbaka' }))).toBe(true);
  });

  /* A retry is about the server coming back, so it asks whatever the queue holds. */
  it('tries again after a failure whether or not anything is queued', () => {
    expect(skaSynkas(lage({ anledning: 'nytt-forsok', osankta: 0 }))).toBe(true);
    expect(skaSynkas(lage({ anledning: 'nytt-forsok', aktiv: false }))).toBe(false);
  });

  /* A change made here is only worth a round when there is one to send. */
  it('only sends a change of its own when there is something to send', () => {
    expect(skaSynkas(lage({ anledning: 'ny-handelse', osankta: 0 }))).toBe(false);
    expect(skaSynkas(lage({ anledning: 'ny-handelse', osankta: 1 }))).toBe(true);
  });

  /*
   * Hard rule 7: no network traffic until sync has been set up, which is
   * three deliberate acts - a server, a login and a passphrase.
   */
  it('does nothing at all until sync is set up', () => {
    for (const anledning of [
      'start',
      'synlig',
      'natet-tillbaka',
      'ny-handelse',
      'nytt-forsok',
    ] as const) {
      expect(skaSynkas(lage({ aktiv: false, osankta: 5, anledning }))).toBe(false);
    }
  });

  it('waits for the network rather than failing against it', () => {
    expect(skaSynkas(lage({ online: false }))).toBe(false);
    expect(skaSynkas(lage({ online: false, anledning: 'ny-handelse', osankta: 3 }))).toBe(
      false,
    );
  });

  /*
   * Two rounds at once would send the queue twice. The server's unique index
   * would absorb it, but the phone would spend a minute uploading receipts it
   * had already uploaded.
   */
  it('never starts a round while one is running', () => {
    expect(skaSynkas(lage({ pagar: true }))).toBe(false);
    expect(skaSynkas(lage({ pagar: true, anledning: 'ny-handelse', osankta: 9 }))).toBe(
      false,
    );
  });
});

/*
 * The server is a computer at home that restarts now and then. The first
 * retry should catch one that has just finished booting; after that the
 * waits level off, so a server gone for the evening is asked rarely.
 */
describe('vantetidEfterFel', () => {
  it('waits longer after each failure, up to five minutes', () => {
    expect(vantetidEfterFel(1)).toBe(15_000);
    expect(vantetidEfterFel(2)).toBe(60_000);
    expect(vantetidEfterFel(3)).toBe(300_000);
    expect(vantetidEfterFel(40)).toBe(300_000);
  });

  it('treats a count below one as the first failure', () => {
    expect(vantetidEfterFel(0)).toBe(15_000);
  });
});
