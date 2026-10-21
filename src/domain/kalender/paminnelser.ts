import { kommandeMomsdeklarationer } from '../moms/deklarationsdag';
import type { Momsperiod } from '../moms/period';
import type { Rakenskapsar } from '../rakenskapsar/rakenskapsar';
import { sistaDagForInkomstdeklaration } from '../skatt/inkomstdeklaration';
import { ar, type Datum } from '../tid/datum';
import { vantandeFakturor } from '../underlag/forfallodag';
import { tolkaKvitto } from '../underlag/kvittotolkning';
import type { Underlag } from '../underlag/underlag';
import type { Kalenderpost } from './ics';

export interface Paminnelseunderlag {
  readonly rakenskapsar: readonly Rakenskapsar[];
  readonly momsperiod: Momsperiod;
  /** The receipts and invoices waiting to be booked. */
  readonly underlag: readonly Underlag[];
  readonly idag: Datum;
}

/**
 * Every date ahead that something has to reach Skatteverket or a supplier by,
 * soonest first, as entries for a calendar.
 *
 * Only what Kontera already knows goes in: the momsdeklarationer of the open
 * years, the inkomstdeklaration for every year in the books, and the invoices
 * with a due date. A year not created yet has no dates, so the file is worth
 * exporting again after each new räkenskapsår.
 */
export function paminnelser({
  rakenskapsar,
  momsperiod,
  underlag,
  idag,
}: Paminnelseunderlag): Kalenderpost[] {
  const moms = kommandeMomsdeklarationer(rakenskapsar, momsperiod, idag).map(
    ({ period, sistaDag }): Kalenderpost => ({
      uid: `moms-${period.fran}@kontera`,
      datum: sistaDag,
      rubrik: `Momsdeklaration ${period.namn}`,
      beskrivning:
        `Sista dag att deklarera och betala momsen för ${period.fran} – ${period.till}. ` +
        'Lås perioden i Kontera när deklarationen är inlämnad.',
    }),
  );

  const beskattningsar = [...new Set(rakenskapsar.map((post) => ar(post.slut)))];
  const inkomst = beskattningsar
    .map((beskattningsar) => ({
      beskattningsar,
      sistaDag: sistaDagForInkomstdeklaration(beskattningsar),
    }))
    .filter(({ sistaDag }) => sistaDag >= idag)
    .map(({ beskattningsar, sistaDag }): Kalenderpost => ({
      uid: `inkomstdeklaration-${beskattningsar}@kontera`,
      datum: sistaDag,
      rubrik: `Inkomstdeklaration ${beskattningsar}`,
      beskrivning:
        `Sista dag att lämna inkomstdeklarationen med NE-bilaga för ${beskattningsar}. ` +
        'Gäller om inget ombud har fått längre tid.',
    }));

  const fakturor = vantandeFakturor(underlag, idag)
    .filter(({ dagarKvar }) => dagarKvar >= 0)
    .map(({ underlag: post, forfallodag }): Kalenderpost => {
      const leverantor =
        post.text === undefined ? undefined : tolkaKvitto(post.text, idag).leverantor;
      return {
        uid: `faktura-${post.id}@kontera`,
        datum: forfallodag,
        rubrik:
          leverantor === undefined
            ? 'Betala faktura'
            : `Betala faktura från ${leverantor}`,
        beskrivning: `Underlag: ${post.filnamn}. Bokför betalningen i Kontera när den är gjord.`,
      };
    });

  return [...moms, ...inkomst, ...fakturor].sort((a, b) =>
    a.datum === b.datum ? a.uid.localeCompare(b.uid) : a.datum < b.datum ? -1 : 1,
  );
}
