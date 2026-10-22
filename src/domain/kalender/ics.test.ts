import { readFileSync } from 'node:fs';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { datum } from '../tid/datum';
import { skrivIcs, type Kalenderpost } from './ics';

const STAMPEL = '2026-10-04T18:30:00.000Z';

const POSTER: readonly Kalenderpost[] = [
  {
    uid: 'moms-2026-07-01@kontera',
    datum: datum('2026-11-12'),
    rubrik: 'Momsdeklaration 2026 kv 3',
    beskrivning:
      'Sista dag att deklarera och betala momsen för 2026-07-01 – 2026-09-30. ' +
      'Lås perioden i Bokfink när deklarationen är inlämnad.',
  },
  {
    uid: 'faktura-1@kontera',
    datum: datum('2026-12-31'),
    rubrik: 'Betala faktura från Lantbrukstjänst i Ekeby AB',
  },
];

describe('skrivIcs', () => {
  /*
   * The fixture was checked by hand against RFC 5545 - CRLF endings, all-day
   * DTSTART/DTEND with DTEND the day after (3.6.1), the long DESCRIPTION
   * folded at 75 octets without splitting a character - and read back with
   * Python's icalendar package, which gave the same dates, the unfolded text
   * and alarms at 09:00 a week before and on the day. Not yet tried in iOS
   * Calendar itself.
   */
  it('matches the reference file', () => {
    const facit = readFileSync(
      new URL('./__fixtures__/paminnelser.ics', import.meta.url),
      'utf8',
    );
    expect(skrivIcs(POSTER, STAMPEL)).toBe(facit);
  });

  it('ends an entry on the last day of the year in the next year', () => {
    expect(skrivIcs(POSTER, STAMPEL)).toContain('DTEND;VALUE=DATE:20270101');
  });

  it('escapes the characters the format reserves', () => {
    const ics = skrivIcs(
      [{ uid: 'x', datum: datum('2026-01-02'), rubrik: 'a,b;c\\d\ne' }],
      STAMPEL,
    );
    expect(ics).toContain('SUMMARY:a\\,b\\;c\\\\d\\ne');
  });

  it('refuses a stamp that is not in UTC', () => {
    expect(() => skrivIcs(POSTER, '2026-10-04T20:30:00+02:00')).toThrow(TypeError);
  });

  /*
   * Folding must lose nothing and never leave a line over 75 octets, whatever
   * mix of one- and multi-byte characters the text has.
   */
  it('folds every line to at most 75 octets and unfolds to the same text', () => {
    fc.assert(
      fc.property(
        fc.string({
          unit: fc.constantFrom('a', 'å', 'ö', '€', '😀', ' '),
          maxLength: 300,
        }),
        (rubrik) => {
          const ics = skrivIcs(
            [{ uid: 'x', datum: datum('2026-01-02'), rubrik }],
            STAMPEL,
          );
          for (const rad of ics.split('\r\n')) {
            expect(new TextEncoder().encode(rad).length).toBeLessThanOrEqual(75);
          }
          const utvikt = ics.replaceAll('\r\n ', '');
          expect(utvikt).toContain(`SUMMARY:${rubrik}\r\n`);
        },
      ),
    );
  });
});
