import { delaOchAvrunda, negate, ore, type Ore } from '../belopp/ore';
import { kontonummer, type Kontonummer } from '../konto/konto';
import type { Kontering } from '../verifikat/verifikat';

/** Paid purchases without invoiced VAT, 25% Swedish VAT and full deduction. */
export const UTLANDSKOP = {
  'eu-tjanst': {
    namn: 'Tjänst från annat EU-land enligt huvudregeln',
    konto: '4535',
    ruta: 21,
  },
  'eu-vara': { namn: 'Varor från annat EU-land', konto: '4515', ruta: 20 },
  'utanfor-eu-tjanst': {
    namn: 'Tjänst från land utanför EU enligt huvudregeln',
    konto: '4531',
    ruta: 22,
  },
} as const;
export type Utlandskopstyp = keyof typeof UTLANDSKOP;

/**
 * Skatteverket, "Fylla i momsdeklarationen", fields 20-22, 30 and 48:
 * https://www.skatteverket.se/foretag/moms/deklareramoms/fyllaimomsdeklarationen.4.3a2a542410ab40a421c80004214.html
 * The base is the invoice without VAT. Both the output VAT and its fully
 * deductible input VAT are booked, without changing what is paid. The caller
 * must explicitly establish the scope above; this is not a rule for every
 * foreign purchase (hotel, passenger transport and imports of goods differ).
 */
export function utlandskopKonteringar(
  typ: Utlandskopstyp,
  underlag: Ore,
  betalkonto: Kontonummer,
): Kontering[] {
  const val = UTLANDSKOP[typ];
  if (val === undefined) throw new TypeError('Välj vilken sorts inköp det är.');
  ore(underlag);
  if (underlag === 0) throw new TypeError('Inköpets belopp får inte vara noll.');
  if (!['1930', '2013', '1910'].includes(betalkonto))
    throw new TypeError('Välj ett betalkonto.');
  // 25% = one quarter. No multiplication that could exceed safe integers;
  // halves away from zero at an öre, as named in delaOchAvrunda. Negative
  // bases are credit notes and reverse all four rows, including the VAT.
  const moms = delaOchAvrunda(underlag, 4);
  return [
    { konto: kontonummer(val.konto), belopp: underlag },
    { konto: kontonummer('2614'), belopp: negate(moms) },
    { konto: kontonummer('2645'), belopp: moms },
    { konto: betalkonto, belopp: negate(underlag) },
  ];
}
