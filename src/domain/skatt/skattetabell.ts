import { oreFromKronor, type Ore } from '../belopp/ore';

/**
 * Figures the tax and accounting rules peg to a given year, rather than to
 * anything Kontera decides itself.
 *
 * This is the first "versioned yearly data" table in the codebase — moms
 * rates today are flat constants because mervärdesskattelagen's rates
 * haven't changed since Etapp 2 was built. Prisbasbeloppet changes every
 * year, so the shape here (an append-only list, one row per year, each row
 * citing where the figure came from) is what every later addition -
 * egenavgifter, schablonavdrag, milersättning - should follow: add a row for
 * the new year, never edit an old one.
 */
export interface Skattetabellrad {
  readonly ar: number;
  readonly prisbasbelopp: Ore;
  readonly forhojtPrisbasbelopp: Ore;
}

/**
 * Fastställs av regeringen varje september för året därpå
 * (regeringen.se, pressmeddelanden "Prisbasbelopp för <år> fastställt").
 * Siffrorna nedan är hämtade och verifierade en och en, inte extrapolerade.
 */
const SKATTETABELL: readonly Skattetabellrad[] = [
  {
    ar: 2023,
    prisbasbelopp: oreFromKronor('52500'),
    forhojtPrisbasbelopp: oreFromKronor('53500'),
  },
  {
    ar: 2024,
    prisbasbelopp: oreFromKronor('57300'),
    forhojtPrisbasbelopp: oreFromKronor('58500'),
  },
  {
    ar: 2025,
    prisbasbelopp: oreFromKronor('58800'),
    forhojtPrisbasbelopp: oreFromKronor('60000'),
  },
  {
    ar: 2026,
    prisbasbelopp: oreFromKronor('59200'),
    forhojtPrisbasbelopp: oreFromKronor('60500'),
  },
];

export class OkantSkattearError extends Error {
  constructor(ar: number) {
    super(
      `Prisbasbeloppet för ${ar} finns inte inlagt. Hämta det från SCB eller skriv ` +
        'in det under Anläggningar, Prisbasbelopp.',
    );
    this.name = 'OkantSkattearError';
  }
}

function rad(ar: number): Skattetabellrad {
  const funnen = SKATTETABELL.find((r) => r.ar === ar);
  if (funnen === undefined) {
    throw new OkantSkattearError(ar);
  }
  return funnen;
}

/**
 * The prisbasbelopp for a year: from the table when it has the year, and
 * otherwise from what the owner has entered.
 *
 * The table wins: its figures are checked against regeringen's decision one
 * by one. An entered figure fills a year the shipped app does not know yet -
 * fetched from SCB's statistikdatabas or typed in, which is the owner's
 * decision of 2026-09-13 rather than a guess (see OkantSkattearError).
 */
export function prisbasbelopp(
  ar: number,
  egna: ReadonlyMap<number, Ore> = new Map(),
): Ore {
  const iTabellen = SKATTETABELL.find((r) => r.ar === ar);
  if (iTabellen !== undefined) {
    return iTabellen.prisbasbelopp;
  }
  const eget = egna.get(ar);
  if (eget === undefined) {
    throw new OkantSkattearError(ar);
  }
  return eget;
}

/**
 * Refuses a figure that cannot be a prisbasbelopp.
 *
 * Socialförsäkringsbalken (2010:110) 2 kap. 7 §: the prisbasbelopp is
 * rounded to the nearest hundred kronor, so anything else is a typing error.
 */
export function kontrolleraPrisbasbelopp(belopp: Ore): void {
  if (belopp <= 0 || belopp % 10000 !== 0) {
    throw new RangeError(
      'Ett prisbasbelopp är alltid ett helt hundratal kronor, till exempel 59 600.',
    );
  }
}

/** Every year with a known prisbasbelopp, the table's and the owner's. */
export function kandaPrisbasbelopp(
  egna: ReadonlyMap<number, Ore> = new Map(),
): ReadonlyMap<number, { belopp: Ore; eget: boolean }> {
  const alla = new Map<number, { belopp: Ore; eget: boolean }>();
  for (const [ar, belopp] of egna) {
    alla.set(ar, { belopp, eget: true });
  }
  for (const radeniTabellen of SKATTETABELL) {
    alla.set(radeniTabellen.ar, { belopp: radeniTabellen.prisbasbelopp, eget: false });
  }
  return new Map([...alla].sort(([a], [b]) => b - a));
}

export function forhojtPrisbasbelopp(ar: number): Ore {
  return rad(ar).forhojtPrisbasbelopp;
}

/**
 * Halva prisbasbeloppet, gränsen för direktavdrag på inventarier (BFN K1
 * punkt 6.30, 6.38) och för lager (punkt 6.47). Beloppen i tabellen är alltid
 * hela hundratal kronor, så heltalsdivisionen tappar aldrig en öre - men
 * avrundas nedåt ändå, som en medveten, testad regel snarare än en tyst
 * förutsättning.
 */
export function halvtPrisbasbelopp(
  ar: number,
  egna: ReadonlyMap<number, Ore> = new Map(),
): Ore {
  return Math.floor(prisbasbelopp(ar, egna) / 2) as Ore;
}
