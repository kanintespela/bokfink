import { datumAv, delar, sistaIManaden, type Datum } from '../tid/datum';

/**
 * How often the VAT return is filed.
 *
 * Which one applies depends on turnover and on what was chosen at
 * registration: skatteförfarandelagen 26 kap. sets monthly, quarterly or
 * yearly periods. It is a setting rather than something Kontera can work out.
 */
export type Momsperiod = 'manad' | 'kvartal' | 'ar';

export interface Redovisningsperiod {
  readonly namn: string;
  readonly fran: Datum;
  readonly till: Datum;
}

/** Every period of the given length inside a fiscal year. */
export function perioder(
  arstart: Datum,
  arslut: Datum,
  momsperiod: Momsperiod,
): Redovisningsperiod[] {
  const { ar } = delar(arstart);

  if (momsperiod === 'ar') {
    return [{ namn: String(ar), fran: arstart, till: arslut }];
  }

  const steg = momsperiod === 'manad' ? 1 : 3;
  const resultat: Redovisningsperiod[] = [];

  for (let manad = 1; manad <= 12; manad += steg) {
    const fran = datumAv(ar, manad, 1);
    const till = sistaIManaden(datumAv(ar, manad + steg - 1, 1));
    resultat.push({
      namn:
        momsperiod === 'manad'
          ? `${ar}-${String(manad).padStart(2, '0')}`
          : `${ar} kv ${Math.ceil(manad / steg)}`,
      fran,
      till,
    });
  }

  return resultat;
}

/** The period a date falls in, when one does. */
export function periodFor(
  perioderna: readonly Redovisningsperiod[],
  datum: Datum,
): Redovisningsperiod | undefined {
  return perioderna.find((period) => datum >= period.fran && datum <= period.till);
}
