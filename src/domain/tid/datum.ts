/**
 * A calendar date, as `YYYY-MM-DD`.
 *
 * Hard rule 3: dates in the domain are strings, interpreted in
 * Europe/Stockholm. A date carries no time and no zone of its own — the only
 * place the zone matters is when turning "now" into a date, and that is the
 * clock's job, in a layer that is allowed to look at one. See {@link Klocka}.
 *
 * The lexical order of `YYYY-MM-DD` is its chronological order, so dates sort
 * and index correctly as plain strings and can be compared with < and >.
 */
export type Datum = string & { readonly __brand: 'Datum' };

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface Datumdelar {
  readonly ar: number;
  readonly manad: number;
  readonly dag: number;
}

/**
 * Validates a `YYYY-MM-DD` string, rejecting dates the calendar does not
 * have. "2026-02-30" parses as digits but is not a day, and a verifikat
 * dated to it would be unbookable.
 */
export function datum(text: string): Datum {
  const match = PATTERN.exec(text);
  if (!match) {
    throw new TypeError(`"${text}" är inte ett datum på formen ÅÅÅÅ-MM-DD.`);
  }

  const ar = Number(match[1]);
  const manad = Number(match[2]);
  const dag = Number(match[3]);

  if (manad < 1 || manad > 12 || dag < 1 || dag > daysInMonth(ar, manad)) {
    throw new RangeError(`Datumet "${text}" finns inte i kalendern.`);
  }

  return text as Datum;
}

export function datumAv(ar: number, manad: number, dag: number): Datum {
  const text = `${pad(ar, 4)}-${pad(manad, 2)}-${pad(dag, 2)}`;
  return datum(text);
}

export function delar(value: Datum): Datumdelar {
  // Already validated on the way in, so the shape is known here.
  return {
    ar: Number(value.slice(0, 4)),
    manad: Number(value.slice(5, 7)),
    dag: Number(value.slice(8, 10)),
  };
}

/** Negative when `a` is earlier, zero when equal, positive when later. */
export function jamfor(a: Datum, b: Datum): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function ar(value: Datum): number {
  return delar(value).ar;
}

export function forsta(...values: readonly Datum[]): Datum | undefined {
  return values.reduce<Datum | undefined>(
    (lowest, value) => (lowest === undefined || value < lowest ? value : lowest),
    undefined,
  );
}

/** True when `value` falls within the closed interval, both ends included. */
export function inomIntervall(value: Datum, from: Datum, to: Datum): boolean {
  return value >= from && value <= to;
}

export function addDagar(value: Datum, days: number): Datum {
  if (!Number.isInteger(days)) {
    throw new TypeError(`Antalet dagar måste vara ett heltal, fick ${days}.`);
  }
  const { ar: y, manad: m, dag: d } = delar(value);
  return fromDayNumber(toDayNumber(y, m, d) + days);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function dagarMellan(from: Datum, to: Datum): number {
  const a = delar(from);
  const b = delar(to);
  return toDayNumber(b.ar, b.manad, b.dag) - toDayNumber(a.ar, a.manad, a.dag);
}

export function forstaIManaden(value: Datum): Datum {
  const { ar: y, manad: m } = delar(value);
  return datumAv(y, m, 1);
}

export function sistaIManaden(value: Datum): Datum {
  const { ar: y, manad: m } = delar(value);
  return datumAv(y, m, daysInMonth(y, m));
}

export function forstaIAret(value: Datum): Datum {
  return datumAv(delar(value).ar, 1, 1);
}

export function sistaIAret(value: Datum): Datum {
  return datumAv(delar(value).ar, 12, 31);
}

export function arSkottar(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return arSkottar(year) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

/*
 * Day arithmetic is done on a day count rather than through Date, for two
 * reasons. Hard rule 3 forbids `new Date` in this layer, and Date.UTC alone
 * cannot get back from milliseconds to year-month-day without constructing
 * one. Counting days also sidesteps daylight saving entirely: adding a day to
 * a date-only value must never land on a 23- or 25-hour day.
 *
 * These are Howard Hinnant's days_from_civil and civil_from_days from
 * "chrono-Compatible Low-Level Date Algorithms", placed in the public domain.
 * Day 0 is 1970-01-01.
 */
function toDayNumber(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromDayNumber(dayNumber: number): Datum {
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) /
      365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return datumAv(y + (month <= 2 ? 1 : 0), month, day);
}
