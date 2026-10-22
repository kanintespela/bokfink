import { dagarMellan, type Datum } from '../tid/datum';
import { arOkopplat, type Underlag } from './underlag';

export interface VantandeFaktura {
  readonly underlag: Underlag;
  readonly forfallodag: Datum;
  /** Negative once the due date has passed. */
  readonly dagarKvar: number;
}

/**
 * The invoices waiting to be paid, the one due first at the top.
 *
 * Under kontantmetoden an invoice is booked when it is paid, and booking is
 * what links its underlag to a verifikat - so a linked underlag is a paid
 * invoice, and drops out here without anyone having to clear its due date.
 */
export function vantandeFakturor(
  underlag: readonly Underlag[],
  idag: Datum,
): VantandeFaktura[] {
  return underlag
    .filter(arOkopplat)
    .flatMap((post) =>
      post.forfallodag === undefined
        ? []
        : [
            {
              underlag: post,
              forfallodag: post.forfallodag,
              dagarKvar: dagarMellan(idag, post.forfallodag),
            },
          ],
    )
    .sort((a, b) =>
      a.forfallodag === b.forfallodag
        ? a.underlag.tillagd.localeCompare(b.underlag.tillagd)
        : a.forfallodag < b.forfallodag
          ? -1
          : 1,
    );
}
