import { addDagar, type Datum } from '../tid/datum';

/** One all-day entry in a calendar file. */
export interface Kalenderpost {
  /**
   * Stable across exports, so a calendar that honours it updates the entry
   * instead of adding a second one when the file is imported again.
   */
  readonly uid: string;
  readonly datum: Datum;
  readonly rubrik: string;
  readonly beskrivning?: string;
}

const CRLF = '\r\n';

/** RFC 5545 3.1: content lines are folded at 75 octets. */
const MAX_OKTETTER = 75;

/**
 * Writes an iCalendar file (RFC 5545) of all-day entries, each with two
 * alarms: a week before and on the day, both at nine in the morning.
 *
 * Handwritten for the same reason as the SIE and SRU writers: the format is a
 * few dozen lines of text, and a file meant to be opened by iOS Calendar years
 * from now should not depend on this project's dependency tree. `stampel` is
 * the export's instant as an ISO 8601 string in UTC; the domain does not read
 * the clock (hard rule 3).
 */
export function skrivIcs(poster: readonly Kalenderpost[], stampel: string): string {
  const dtstamp = icsTidpunkt(stampel);
  const rader = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kontera//Kontera//SV',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...poster.flatMap((post) => [
      'BEGIN:VEVENT',
      `UID:${text(post.uid)}`,
      `DTSTAMP:${dtstamp}`,
      // An all-day event ends, exclusively, on the day after (RFC 5545 3.6.1).
      `DTSTART;VALUE=DATE:${icsDatum(post.datum)}`,
      `DTEND;VALUE=DATE:${icsDatum(addDagar(post.datum, 1))}`,
      `SUMMARY:${text(post.rubrik)}`,
      ...(post.beskrivning === undefined
        ? []
        : [`DESCRIPTION:${text(post.beskrivning)}`]),
      'TRANSP:TRANSPARENT',
      ...alarm('-P6DT15H', post.rubrik),
      ...alarm('PT9H', post.rubrik),
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return rader.map(vik).join(CRLF) + CRLF;
}

/** Relative to the start of the day, which for an all-day event is midnight. */
function alarm(trigger: string, rubrik: string): string[] {
  return [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `TRIGGER:${trigger}`,
    `DESCRIPTION:${text(rubrik)}`,
    'END:VALARM',
  ];
}

function icsDatum(datum: Datum): string {
  return datum.replaceAll('-', '');
}

function icsTidpunkt(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(iso);
  if (!match) {
    throw new TypeError(
      `"${iso}" är inte en tidpunkt i UTC på formen ÅÅÅÅ-MM-DDTtt:mm:ssZ.`,
    );
  }
  return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6]}Z`;
}

/** RFC 5545 3.3.11: backslash, semicolon, comma and newline are escaped. */
function text(varde: string): string {
  return varde
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Folds a line into chunks of at most 75 octets of UTF-8, each continuation
 * starting with a space. Splits only between code points, since a fold inside
 * an å would leave two halves that are not characters at all.
 */
function vik(rad: string): string {
  const delar: string[] = [];
  let aktuell = '';
  let oktetter = 0;
  for (const tecken of rad) {
    const storlek = utf8Langd(tecken);
    // The first line has the full 75; a continuation spends one on its space.
    const grans = delar.length === 0 ? MAX_OKTETTER : MAX_OKTETTER - 1;
    if (oktetter + storlek > grans) {
      delar.push(aktuell);
      aktuell = '';
      oktetter = 0;
    }
    aktuell += tecken;
    oktetter += storlek;
  }
  delar.push(aktuell);
  return delar.join(`${CRLF} `);
}

function utf8Langd(tecken: string): number {
  const kod = tecken.codePointAt(0) ?? 0;
  return kod < 0x80 ? 1 : kod < 0x800 ? 2 : kod < 0x10000 ? 3 : 4;
}
