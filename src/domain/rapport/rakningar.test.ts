import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { oreFromKronor, type Ore } from '../belopp/ore';
import { kontonummer, skapaKonto, type Konto, type Kontonummer } from '../konto/konto';
import type { Uuid } from '../id/uuidv7';
import { datum } from '../tid/datum';
import { verifikatserie } from '../verifikat/serie';
import { bokfor, skapaUtkast, type BokfortVerifikat } from '../verifikat/verifikat';
import { beraknaBalansrakning } from './balansrakning';
import { beraknaResultatrakning } from './resultatrakning';
import { beraknaPeriodsaldon, beraknaSaldon } from './saldon';

const kr = (text: string) => oreFromKronor(text);

const KONTON: ReadonlyMap<Kontonummer, Konto> = new Map(
  [
    ['1930', 'Företagskonto', 'tillgang'],
    ['2013', 'Egna insättningar och uttag', 'egetKapital'],
    ['2640', 'Ingående moms', 'skuld'],
    ['2611', 'Utgående moms 25 %', 'skuld'],
    ['3010', 'Försäljning', 'intakt'],
    ['4010', 'Inköp av material och varor', 'kostnad'],
    ['6110', 'Kontorsmateriel', 'kostnad'],
    ['8310', 'Ränteintäkter', 'intakt'],
    ['8410', 'Räntekostnader', 'kostnad'],
  ].map(([nummer, namn, typ]) => [
    kontonummer(nummer!),
    skapaKonto({ nummer: nummer!, namn: namn!, typ: typ as Konto['typ'] }),
  ]),
);

let raknare = 0;

function verifikat(
  datumtext: string,
  rader: readonly (readonly [string, string])[],
): BokfortVerifikat {
  raknare += 1;
  return bokfor(
    skapaUtkast({
      id: `019b76da-a800-7000-8000-${String(raknare).padStart(12, '0')}` as Uuid,
      datum: datum(datumtext),
      beskrivning: 'test',
      konteringar: rader.map(([konto, belopp]) => ({
        konto: kontonummer(konto),
        belopp: kr(belopp),
      })),
    }),
    {
      serie: verifikatserie('A'),
      nummer: raknare,
      bokfortDatum: datum(datumtext),
      kalla: 'manuell',
    },
  );
}

/*
 * A worked example, small enough to add up by hand and complete enough to
 * exercise every side of both reports.
 *
 * Opening: 10 000 in the bank against 10 000 of own capital.
 *
 *   feb  sale of 12 500 including 2 500 VAT       bank +12 500
 *   mar  purchase of 5 000 plus 1 250 VAT         bank  -6 250
 *   apr  office supplies 800 plus 200 VAT         bank  -1 000
 *   maj  interest received                        bank     +75
 *   jun  interest paid                            bank    -125
 *
 * Bank: 10 000 + 12 500 - 6 250 - 1 000 + 75 - 125 = 15 200
 * Result: 10 000 income - 5 000 - 800 + 75 - 125 = 4 150
 * VAT owed: 2 500 out - 1 450 in = 1 050 net liability
 * Balance: 15 200 assets = 10 000 capital + 4 150 result + 1 050 VAT
 */
const INGAENDE = [{ konto: kontonummer('1930'), belopp: kr('10000.00') }];
const HANDELSER = [
  verifikat('2026-02-13', [
    ['1930', '12500.00'],
    ['3010', '-10000.00'],
    ['2611', '-2500.00'],
  ]),
  verifikat('2026-03-05', [
    ['4010', '5000.00'],
    ['2640', '1250.00'],
    ['1930', '-6250.00'],
  ]),
  verifikat('2026-04-01', [
    ['6110', '800.00'],
    ['2640', '200.00'],
    ['1930', '-1000.00'],
  ]),
  verifikat('2026-05-31', [
    ['1930', '75.00'],
    ['8310', '-75.00'],
  ]),
  verifikat('2026-06-30', [
    ['8410', '125.00'],
    ['1930', '-125.00'],
  ]),
];

const IB_2013 = [
  { konto: kontonummer('1930'), belopp: kr('10000.00') },
  { konto: kontonummer('2013'), belopp: kr('-10000.00') },
];

/** The year the worked example is booked in, with its opening balances. */
const AR_2026 = { start: datum('2026-01-01'), ingaendeBalanser: IB_2013 };

describe('beraknaResultatrakning', () => {
  const saldon = beraknaSaldon(INGAENDE, HANDELSER);
  const rapport = beraknaResultatrakning(saldon, KONTON);

  it('shows income positive and costs negative, as a report is printed', () => {
    const rader = rapport.grupper.flatMap((grupp) => grupp.poster);
    expect(belopp(rader, '3010')).toBe(kr('10000.00'));
    expect(belopp(rader, '4010')).toBe(kr('-5000.00'));
    expect(belopp(rader, '6110')).toBe(kr('-800.00'));
  });

  it('groups by what the account numbers already say', () => {
    expect(rapport.grupper.map((grupp) => grupp.rubrik)).toEqual([
      'Rörelsens intäkter',
      'Varor, material och tjänster',
      'Övriga externa kostnader',
      'Finansiella poster',
    ]);
  });

  it('adds up to the result worked out by hand', () => {
    // 10 000 - 5 000 - 800 = 4 200 before financial items.
    expect(rapport.rorelseresultat).toBe(kr('4200.00'));
    // 75 received less 125 paid.
    expect(rapport.finansiellaPoster).toBe(kr('-50.00'));
    expect(rapport.aretsResultat).toBe(kr('4150.00'));
  });

  /*
   * Class 8 holds income and cost side by side and cannot be split by number.
   * Negating every line once means it never has to be.
   */
  it('puts financial income and cost on their own sides without being told', () => {
    const finansiella = rapport.grupper.at(-1)!.poster;
    expect(belopp(finansiella, '8310')).toBe(kr('75.00'));
    expect(belopp(finansiella, '8410')).toBe(kr('-125.00'));
  });

  it('leaves out accounts that did not move', () => {
    const rader = rapport.grupper.flatMap((grupp) => grupp.poster);
    expect(rader.some((rad) => rad.konto === kontonummer('1930'))).toBe(false);
  });
});

describe('beraknaBalansrakning', () => {
  const saldon = beraknaSaldon(IB_2013, HANDELSER);
  const rapport = beraknaBalansrakning(saldon, KONTON);

  it('adds up to the position worked out by hand', () => {
    // 10 000 + 12 500 - 6 250 - 1 000 + 75 - 125
    expect(rapport.summaTillgangar).toBe(kr('15200.00'));
    expect(rapport.aretsResultat).toBe(kr('4150.00'));
    expect(rapport.summaEgetKapitalOchSkulder).toBe(kr('15200.00'));
    expect(rapport.differens).toBe(0);
  });

  it('shows both sides positive', () => {
    const eget = rapport.egetKapitalOchSkulder.flatMap((grupp) => grupp.poster);
    expect(belopp(eget, '2013')).toBe(kr('10000.00'));
    // 2 500 charged less 1 450 paid, still owed to Skatteverket.
    expect(belopp(eget, '2611')).toBe(kr('2500.00'));
    expect(belopp(eget, '2640')).toBe(kr('-1450.00'));
  });

  it('groups by the BAS chart', () => {
    expect(rapport.tillgangar.map((grupp) => grupp.rubrik)).toEqual(['Kassa och bank']);
    expect(rapport.egetKapitalOchSkulder.map((grupp) => grupp.rubrik)).toEqual([
      'Eget kapital',
      'Kortfristiga skulder',
    ]);
  });

  /*
   * The invariant the whole report rests on. Every verifikat balances, so a
   * balance sheet drawn from any set of them balances too - as long as the
   * result that has not been closed into equity is carried as its own line.
   */
  it('balances for any bookkeeping that can be built', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom('3010', '4010', '6110', '8310', '8410'),
            fc.integer({ min: -500_000, max: 500_000 }),
          ),
          { maxLength: 20 },
        ),
        (rader) => {
          const poster = rader.map(([konto, belopp]) =>
            verifikat('2026-06-15', [
              [konto, kronor(belopp)],
              ['1930', kronor(-belopp)],
            ]),
          );
          const rapport = beraknaBalansrakning(beraknaSaldon(IB_2013, poster), KONTON);
          expect(rapport.differens).toBe(0);
        },
      ),
    );
  });
});

describe('beraknaPeriodsaldon', () => {
  it('reports the period and carries what came before it', () => {
    const saldon = beraknaPeriodsaldon(
      AR_2026,
      HANDELSER,
      datum('2026-04-01'),
      datum('2026-06-30'),
    );

    const bank = saldon.get(kontonummer('1930'))!;
    // Everything up to the first of April: 10 000 + 12 500 - 6 250.
    expect(bank.ingaende).toBe(kr('16250.00'));
    // April to June: -1 000 + 75 - 125.
    expect(bank.forandring).toBe(kr('-1050.00'));
    expect(bank.utgaende).toBe(kr('15200.00'));
  });

  it('reports the quarter as its own result, not the whole year', () => {
    const kvartal = beraknaPeriodsaldon(
      AR_2026,
      HANDELSER,
      datum('2026-04-01'),
      datum('2026-06-30'),
    );
    // 800 of supplies, 75 of interest in and 125 out.
    expect(beraknaResultatrakning(kvartal, KONTON).aretsResultat).toBe(kr('-850.00'));
  });

  /*
   * A balance sheet is a position on a date, so the quarter's report has to
   * carry January to March as well - which is the whole reason the result is
   * computed from the opening figure plus the movement.
   */
  it('still balances when the period starts mid-year', () => {
    const kvartal = beraknaPeriodsaldon(
      AR_2026,
      HANDELSER,
      datum('2026-04-01'),
      datum('2026-06-30'),
    );
    const rapport = beraknaBalansrakning(kvartal, KONTON);

    expect(rapport.summaTillgangar).toBe(kr('15200.00'));
    expect(rapport.aretsResultat).toBe(kr('4150.00'));
    expect(rapport.differens).toBe(0);
  });

  /*
   * The bug that showed a paid-off loan as a debt in 2026: the report is
   * handed every verifikat in the books, and those from earlier years were
   * counted as "before the period" on top of an opening balance that already
   * carries them. A loan paid off in 2023 then reappeared, with its sign
   * turned, in every later year's balance sheet.
   */
  it('leaves out earlier years, which the opening balance already carries', () => {
    const forraAret = verifikat('2025-04-03', [
      ['2350', '15825.00'],
      ['1930', '-15825.00'],
    ]);

    const kvartal = beraknaPeriodsaldon(
      AR_2026,
      [forraAret, ...HANDELSER],
      datum('2026-04-01'),
      datum('2026-06-30'),
    );

    expect(kvartal.get(kontonummer('2350'))).toBeUndefined();
    expect(kvartal.get(kontonummer('1930'))?.ingaende).toBe(kr('16250.00'));
    expect(beraknaBalansrakning(kvartal, KONTON).summaTillgangar).toBe(kr('15200.00'));
  });

  it('ignores what happens after the period', () => {
    const forstaKvartalet = beraknaPeriodsaldon(
      AR_2026,
      HANDELSER,
      datum('2026-01-01'),
      datum('2026-03-31'),
    );
    expect(forstaKvartalet.get(kontonummer('1930'))?.utgaende).toBe(kr('16250.00'));
  });
});

function belopp(poster: readonly { konto: Kontonummer; belopp: Ore }[], konto: string) {
  return poster.find((post) => post.konto === kontonummer(konto))?.belopp;
}

/** Whole öre as a decimal string, without ever constructing a float. */
function kronor(ore: number): string {
  const tecken = ore < 0 ? '-' : '';
  const absolut = String(Math.abs(ore)).padStart(3, '0');
  return `${tecken}${absolut.slice(0, -2)}.${absolut.slice(-2)}`;
}
