import { describe, expect, it } from 'vitest';

import { skaSynkas, type Synklage } from './autosynk';

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
