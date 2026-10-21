import { kronorString, type Ore } from '../belopp/ore';

/**
 * Writing a table as CSV that opens correctly in a Swedish Excel.
 *
 * "CSV" is not one format. Excel reads the separator from the operating
 * system's list separator, which is a semicolon in a Swedish locale, and it
 * reads decimals the same way - so a comma-separated file with decimal points
 * opens as one column of text, and one with decimal points and semicolons
 * turns 1.5 into a date. Both are the kind of failure that is noticed only
 * after someone has retyped a report.
 *
 * So: semicolons, decimal commas, CRLF, and a byte order mark. The mark is
 * what tells Excel the file is UTF-8; without it, å and ä arrive broken in
 * exactly the columns a Swedish company writes its account names in.
 */

/** Excel's separator in a Swedish locale. */
const AVGRANSARE = ';';

/** RFC 4180 says CRLF, and Excel on Windows agrees. */
const RADSLUT = '\r\n';

/**
 * The byte order mark, written as a character so the whole file stays a
 * string until the platform layer encodes it.
 */
export const BOM = '﻿';

export type Cell = string | number | Ore | undefined;

/** A value written as an amount rather than as a plain number. */
export interface Belopp {
  readonly ore: Ore;
}

export const belopp = (ore: Ore): Belopp => ({ ore });

export type Falt = Cell | Belopp;

/**
 * Turns rows into a CSV document, with the mark Excel needs at the front.
 *
 * The header row is not special: it is the first row, and callers pass it
 * like any other. That keeps the function honest about what it does.
 */
export function skrivCsv(rader: readonly (readonly Falt[])[]): string {
  return BOM + rader.map(skrivRad).join(RADSLUT) + RADSLUT;
}

function skrivRad(rad: readonly Falt[]): string {
  return rad.map(skrivFalt).join(AVGRANSARE);
}

/**
 * One field, quoted when it has to be.
 *
 * A field is quoted if it contains the separator, a quote or a line break;
 * the quotes inside are doubled, as RFC 4180 says. Everything else is written
 * bare, so a file stays readable in a text editor - which is where anyone
 * checking an export starts.
 */
function skrivFalt(falt: Falt): string {
  if (falt === undefined) {
    return '';
  }
  if (typeof falt === 'object') {
    // An amount: kronor with a decimal comma, no thousands separator. A space
    // between the thousands is what a spreadsheet cannot read back.
    return kronorString(falt.ore).replace('.', ',');
  }
  const text = String(falt);
  if (!/[;"\r\n]/.test(text)) {
    return text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}
