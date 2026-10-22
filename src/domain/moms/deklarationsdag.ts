import type { Rakenskapsar } from '../rakenskapsar/rakenskapsar';
import { dagarMellan, datumAv, delar, type Datum } from '../tid/datum';
import { fristdag } from '../tid/helgdag';
import { perioder, type Momsperiod, type Redovisningsperiod } from './period';

/**
 * The last day a quarter's momsdeklaration may reach Skatteverket.
 *
 * Skatteförfarandelagen (2011:1244) 26 kap. 26 §, the table for
 * mervärdesskattedeklaration: januari-mars senast den 12 maj, april-juni den
 * 17 augusti, juli-september den 12 november, oktober-december den 12
 * februari. 26 kap. 33 § (the 26th of the second month) does not apply to a
 * calendar quarter, by its second stycke. The tax is due the same day:
 * 62 kap. 3 §.
 *
 * A day that is not a vardag moves to the next one, lag (1930:173) om
 * beräkning av lagstadgad tid 2 §; see {@link fristdag}.
 */
export function sistaDeklarationsdagForKvartal(period: Redovisningsperiod): Datum {
  const { ar, manad, dag } = delar(period.fran);
  const slut = delar(period.till);
  if (dag !== 1 || (manad - 1) % 3 !== 0 || slut.ar !== ar || slut.manad !== manad + 2) {
    throw new RangeError(
      `Perioden ${period.fran}–${period.till} är inte ett kalenderkvartal.`,
    );
  }

  const enligtLag =
    manad === 1
      ? datumAv(ar, 5, 12)
      : manad === 4
        ? datumAv(ar, 8, 17)
        : manad === 7
          ? datumAv(ar, 11, 12)
          : datumAv(ar + 1, 2, 12);
  return fristdag(enligtLag);
}

export interface VantandeMomsdeklaration {
  readonly period: Redovisningsperiod;
  readonly sistaDag: Datum;
  /** Negative once the last day has passed. */
  readonly dagarKvar: number;
}

/**
 * The quarters that have ended without being marked as declared, oldest
 * first.
 *
 * A quarter counts as declared once its year is momslåst through its last
 * day, since locking is what the Moms page does after a deklaration is
 * filed. A closed year is skipped: nothing in it can be changed any more,
 * and an imported history would otherwise raise every quarter it holds.
 *
 * Only quarterly periods are covered. Monthly ones can follow either of two
 * tables in 26 kap. 26-28 §§, and yearly ones depend on EU trade (33 and
 * 33 a §§) - which applies is something Kontera does not know, so it gives
 * no date rather than guess one.
 */
export function vantandeMomsdeklarationer(
  rakenskapsar: readonly Rakenskapsar[],
  momsperiod: Momsperiod,
  idag: Datum,
): VantandeMomsdeklaration[] {
  if (momsperiod !== 'kvartal') {
    return [];
  }

  return rakenskapsar
    .filter((ar) => !ar.avslutat)
    .flatMap((ar) =>
      perioder(ar.start, ar.slut, 'kvartal')
        .filter((period) => period.till < idag)
        .filter((period) => ar.momslastTom === undefined || ar.momslastTom < period.till)
        .map((period) => {
          const sistaDag = sistaDeklarationsdagForKvartal(period);
          return { period, sistaDag, dagarKvar: dagarMellan(idag, sistaDag) };
        }),
    )
    .sort((a, b) => (a.period.fran < b.period.fran ? -1 : 1));
}

/**
 * Every quarter of the open years not yet locked as declared, whose last day
 * is today or later - ended or not. For a calendar file, where a date
 * already passed is of no use and one ahead is the point.
 */
export function kommandeMomsdeklarationer(
  rakenskapsar: readonly Rakenskapsar[],
  momsperiod: Momsperiod,
  idag: Datum,
): VantandeMomsdeklaration[] {
  if (momsperiod !== 'kvartal') {
    return [];
  }

  return rakenskapsar
    .filter((ar) => !ar.avslutat)
    .flatMap((ar) =>
      perioder(ar.start, ar.slut, 'kvartal')
        .filter((period) => ar.momslastTom === undefined || ar.momslastTom < period.till)
        .map((period) => {
          const sistaDag = sistaDeklarationsdagForKvartal(period);
          return { period, sistaDag, dagarKvar: dagarMellan(idag, sistaDag) };
        }),
    )
    .filter(({ dagarKvar }) => dagarKvar >= 0)
    .sort((a, b) => (a.period.fran < b.period.fran ? -1 : 1));
}
