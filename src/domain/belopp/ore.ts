/**
 * An amount of money, in whole öre.
 *
 * Hard rule 1: money never touches a floating point number. Branding the type
 * is what enforces it — `a + b` on two Ore values does not typecheck, so
 * every arithmetic step has to go through a function here that keeps the
 * result a whole number and refuses to silently lose precision.
 */
export type Ore = number & { readonly __brand: 'Ore' };

export const ZERO: Ore = 0 as Ore;

/**
 * Beyond this, integers stop being exactly representable and addition starts
 * quietly rounding. About 90 000 miljarder kronor, so it is a guard rail
 * rather than a limit anyone reaches.
 */
const MAX_ORE = Number.MAX_SAFE_INTEGER;

/** Optional sign, digits, optionally one or two decimals after . or , */
const DECIMAL = /^([+-]?)(\d+)(?:[.,](\d{1,2}))?$/;

/** Wraps a number that is already a whole count of öre. */
export function ore(value: number): Ore {
  if (!Number.isInteger(value)) {
    throw new TypeError(
      `Belopp måste vara ett heltal öre, fick ${value}. ` +
        'Ett belopp som passerat ett flyttal är en bugg (hård regel 1).',
    );
  }
  if (Math.abs(value) > MAX_ORE) {
    throw new RangeError(`Beloppet ${value} öre är för stort för att räknas exakt.`);
  }
  return value as Ore;
}

/**
 * Reads a decimal amount of kronor, as SIE files and input fields carry it,
 * without ever constructing a float.
 *
 * The digits are concatenated into a whole number of öre and parsed once:
 * "52418.37" becomes the string "5241837". Multiplying by 100 instead would
 * reintroduce exactly the rounding this type exists to prevent.
 */
export function oreFromKronor(text: string): Ore {
  const match = DECIMAL.exec(text.trim());
  if (!match) {
    throw new TypeError(`"${text}" är inte ett belopp Kontera kan tolka.`);
  }

  const [, sign = '', whole = '0', fraction = ''] = match;
  const digits = `${whole}${fraction.padEnd(2, '0')}`;

  const magnitude = Number(digits);
  if (!Number.isSafeInteger(magnitude)) {
    throw new RangeError(`Beloppet "${text}" är för stort för att räknas exakt.`);
  }

  // Guard against -0, which compares equal to 0 but serialises as "-0".
  return magnitude === 0 ? ZERO : (ore(sign === '-' ? -magnitude : magnitude) as Ore);
}

/**
 * The canonical machine-readable form: kronor with a dot and exactly two
 * decimals, which is what SIE and every other exchange format expects.
 */
export function kronorString(amount: Ore): string {
  const negative = amount < 0;
  const digits = String(Math.abs(amount)).padStart(3, '0');
  const whole = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Swedish display form: thousands split by a non-breaking space, decimal
 * comma, e.g. "-1 234,56".
 *
 * Formatted by hand rather than through Intl, so that the output cannot
 * change with the environment's locale data and tests stay deterministic.
 */
/**
 * Non-breaking space, written as an escape so it stays visible in the
 * source. An amount must never wrap across a line in the middle, and this
 * app is mostly read on a narrow screen.
 */
const GROUP_SEPARATOR = '\u00a0';

export function formatKronor(amount: Ore): string {
  const [whole = '0', fraction = '00'] = kronorString(amount).replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
  return `${amount < 0 ? '-' : ''}${grouped},${fraction}`;
}

export function add(a: Ore, b: Ore): Ore {
  return ore(a + b);
}

export function subtract(a: Ore, b: Ore): Ore {
  return ore(a - b);
}

export function negate(amount: Ore): Ore {
  /*
   * Zero has no other side. Without this, negating it produces -0, which
   * compares equal to 0 everywhere except Object.is - and serialises as "-0"
   * in JSON, which is what would reach an export file.
   */
  return amount === 0 ? ZERO : ore(-amount);
}

/**
 * Adds up a run of amounts. Used by the balance check, where the sum of a
 * verifikat's konteringar has to be exactly zero (hard rule 4).
 */
export function sum(amounts: Iterable<Ore>): Ore {
  let total = 0;
  for (const amount of amounts) {
    total += amount;
  }
  return ore(total);
}

export function isZero(amount: Ore): boolean {
  return amount === 0;
}

/**
 * Divides two integers and rounds to the nearest whole öre, halves away from
 * zero - the one rounding rule several domains need for "a fraction of an
 * amount" (moms splitting, avskrivningsprocent) and so share rather than
 * each defining their own. The arithmetic stays in integers throughout;
 * dividing in floating point and rounding afterwards would put money through
 * a float, which hard rule 1 forbids regardless of whether a particular case
 * happens to come out right.
 */
export function delaOchAvrunda(taljare: number, namnare: number): Ore {
  const tecken = taljare < 0 ? -1 : 1;
  const a = Math.abs(taljare);
  const b = Math.abs(namnare);

  if (!Number.isSafeInteger(2 * a + b)) {
    throw new RangeError('Beloppet är för stort för att räknas exakt.');
  }

  return ore(tecken * Math.floor((2 * a + b) / (2 * b)));
}
