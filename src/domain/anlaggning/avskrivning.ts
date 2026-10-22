import {
  add,
  delaOchAvrunda,
  formatKronor,
  subtract,
  sum,
  ZERO,
  type Ore,
} from '../belopp/ore';
import { ar, type Datum } from '../tid/datum';
import type { Anlaggningstillgang } from './anlaggningstillgang';

/**
 * The collective pool depreciation for maskiner och inventarier.
 *
 * BFN K1 (BFNAR 2006:1) punkt 6.38: every machine and inventarie the firm
 * still holds sits in one account, written off as one lump sum per year -
 * never a schedule per item. A sale reduces the pool by the sale price
 * (punkt 6.37) rather than being booked as a separate gain or loss; the
 * realisationsresultat is folded straight into the year's depreciation
 * figure (punkt 7.4, 7.9).
 *
 * The percentages themselves come from inkomstskattelagen 18 kap.: huvud-
 * regeln allows at most 30 % of the underlag per year, kompletteringsregeln
 * (17 §) caps the tax value at each still-held item's own acquisition value
 * less a straight 20 %/year, restvärdesavskrivning allows at most 25 %.
 * Kontera computes all three and lets the figure with the biggest deduction
 * be picked, per the plan's "båda reglerna beräknas parallellt" - it never
 * decides for the user which one to file with.
 */

const HUVUDREGELN_PROCENT = 30;
const RESTVARDESAVSKRIVNING_PROCENT = 25;
const KOMPLETTERINGSREGELN_PROCENT_PER_AR = 20;

export class NegativtAvskrivningsunderlagError extends Error {
  constructor(underlag: Ore) {
    super(
      `Avskrivningsunderlaget är negativt (${formatKronor(underlag)} kr): årets ` +
        'försäljningar var värda mer än vad som fanns kvar i potten. Det ska ' +
        'redovisas som en intäkt (BFN K1 punkt 7.4), inte en avskrivning, och ' +
        'måste bokföras för hand.',
    );
    this.name = 'NegativtAvskrivningsunderlagError';
  }
}

/** Punkt 6.38: IB plus årets inköp, minus vad som kommit in för avyttringar. */
export function avskrivningsunderlag(ib: Ore, aretsInkop: Ore, aretsAvyttrat: Ore): Ore {
  return subtract(add(ib, aretsInkop), aretsAvyttrat);
}

export function huvudregeln(underlag: Ore): Ore {
  return delaOchAvrunda(underlag * HUVUDREGELN_PROCENT, 100);
}

export function restvardesavskrivning(underlag: Ore): Ore {
  return delaOchAvrunda(underlag * RESTVARDESAVSKRIVNING_PROCENT, 100);
}

/**
 * How much of one item's own acquisition value kompletteringsregeln still
 * allows as tax value: a straight 20 %/year, floored at zero after five
 * years. The year of acquisition counts as year one regardless of when
 * during the year it happened - established practice, though not verified
 * against IL's literal text while this was written (see the plan's noted
 * risk). Isolated in its own function so that assumption is easy to correct
 * later without touching the pool arithmetic around it.
 */
function kvarvarandeVardeEnligtKompletteringsregeln(
  tillgang: Anlaggningstillgang,
  rakenskapsaretsSlut: Datum,
): Ore {
  const helaAr = Math.max(
    1,
    ar(rakenskapsaretsSlut) - ar(tillgang.anskaffningsdatum) + 1,
  );
  const avskrivetProcent = Math.min(100, KOMPLETTERINGSREGELN_PROCENT_PER_AR * helaAr);
  const avskrivet = delaOchAvrunda(tillgang.anskaffningsvarde * avskrivetProcent, 100);
  return subtract(tillgang.anskaffningsvarde, avskrivet);
}

export function kompletteringsregeln(
  underlag: Ore,
  innehav: readonly Anlaggningstillgang[],
  rakenskapsaretsSlut: Datum,
): Ore {
  const lagstaTillatnaVarde = sum(
    innehav
      .filter((tillgang) => tillgang.avyttring === undefined)
      .map((tillgang) =>
        kvarvarandeVardeEnligtKompletteringsregeln(tillgang, rakenskapsaretsSlut),
      ),
  );
  const avskrivning = subtract(underlag, lagstaTillatnaVarde);
  return avskrivning > ZERO ? avskrivning : ZERO;
}

export interface Avskrivningsforslag {
  readonly underlag: Ore;
  readonly huvudregeln: Ore;
  readonly kompletteringsregeln: Ore;
  readonly restvardesavskrivning: Ore;
  /** Satt bara när underlaget är högst ett halvt prisbasbelopp (punkt 6.38). */
  readonly helaUnderlaget: Ore | undefined;
}

/**
 * All three methods side by side, plus the direktavdrag-to-zero option when
 * it applies. Throws rather than returning a nonsensical negative figure if
 * the pool itself has gone negative - see {@link NegativtAvskrivningsunderlagError}.
 */
export function avskrivningsforslag(
  underlag: Ore,
  innehav: readonly Anlaggningstillgang[],
  rakenskapsaretsSlut: Datum,
  halvtPrisbasbelopp: Ore,
): Avskrivningsforslag {
  if (underlag < ZERO) {
    throw new NegativtAvskrivningsunderlagError(underlag);
  }

  return {
    underlag,
    huvudregeln: huvudregeln(underlag),
    kompletteringsregeln: kompletteringsregeln(underlag, innehav, rakenskapsaretsSlut),
    restvardesavskrivning: restvardesavskrivning(underlag),
    helaUnderlaget: underlag <= halvtPrisbasbelopp ? underlag : undefined,
  };
}
