import { addDagar, dagarMellan, datum, datumAv, delar, type Datum } from './datum';

/** ISO weekday: 1 is Monday, 7 is Sunday. */
export function veckodag(value: Datum): number {
  // 1970-01-01 was a Thursday, ISO weekday 4.
  const fran = dagarMellan(datum('1970-01-01'), value);
  return ((((fran + 3) % 7) + 7) % 7) + 1;
}

/**
 * Påskdagen, the day every movable holiday is counted from.
 *
 * Lag (1989:253) om allmänna helgdagar 2 §: "söndagen närmast efter den
 * fullmåne som infaller på eller närmast efter den 21 mars". The full moon
 * here is the ecclesiastical one, which the anonymous Gregorian algorithm
 * (Meeus, Jones, Butcher) computes; it gives the dates Swedish almanacs print.
 */
export function paskdagen(ar: number): Datum {
  const a = ar % 19;
  const b = Math.floor(ar / 100);
  const c = ar % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const manad = Math.floor((h + l - 7 * m + 114) / 31);
  const dag = ((h + l - 7 * m + 114) % 31) + 1;
  return datumAv(ar, manad, dag);
}

/** The Saturday in an inclusive range of days within one month. */
function lordagMellan(ar: number, manad: number, fran: number): Datum {
  const forsta = datumAv(ar, manad, fran);
  return addDagar(forsta, (6 - veckodag(forsta) + 7) % 7);
}

/**
 * True on an allmän helgdag.
 *
 * Lag (1989:253) om allmänna helgdagar 1-2 §§: every Sunday, plus
 * nyårsdagen, trettondedag jul, långfredagen, påskdagen, annandag påsk,
 * Kristi himmelsfärdsdag (sjätte torsdagen efter påskdagen), pingstdagen,
 * första maj, nationaldagen, midsommardagen (lördagen 20-26 juni), alla
 * helgons dag (lördagen 31 oktober-6 november), juldagen och annandag jul.
 */
export function arAllmanHelgdag(value: Datum): boolean {
  if (veckodag(value) === 7) {
    return true;
  }

  const { ar, manad, dag } = delar(value);
  const fasta = ['01-01', '01-06', '05-01', '06-06', '12-25', '12-26'];
  if (fasta.includes(value.slice(5))) {
    return true;
  }

  const pask = paskdagen(ar);
  const rorliga = [
    addDagar(pask, -2), // långfredagen
    addDagar(pask, 1), // annandag påsk
    addDagar(pask, 39), // Kristi himmelsfärdsdag
  ];
  if (rorliga.includes(value)) {
    return true;
  }

  if (manad === 6 && dag >= 20 && dag <= 26) {
    return value === lordagMellan(ar, 6, 20);
  }

  // Alla helgons dag straddles a month boundary, so count from 31 October.
  const allaHelgon = lordagMellan(ar, 10, 31);
  return value === allaHelgon;
}

/**
 * True when a deadline falling on this day stays on it.
 *
 * Lag (1930:173) om beräkning av lagstadgad tid 2 §: when the last day for
 * an action falls "på en söndag, annan allmän helgdag, lördag,
 * midsommarafton, julafton eller nyårsafton, får åtgärden vidtas nästa
 * vardag". Midsommarafton is the Friday before midsommardagen.
 */
export function arVardag(value: Datum): boolean {
  if (veckodag(value) === 6 || arAllmanHelgdag(value)) {
    return false;
  }
  const { ar, manad } = delar(value);
  if (value.slice(5) === '12-24' || value.slice(5) === '12-31') {
    return false;
  }
  return !(manad === 6 && value === addDagar(lordagMellan(ar, 6, 20), -1));
}

/**
 * The day a statutory deadline actually falls on: the day itself, or the
 * next vardag after it. Lag (1930:173) om beräkning av lagstadgad tid 2 §.
 */
export function fristdag(value: Datum): Datum {
  let dag = value;
  while (!arVardag(dag)) {
    dag = addDagar(dag, 1);
  }
  return dag;
}
