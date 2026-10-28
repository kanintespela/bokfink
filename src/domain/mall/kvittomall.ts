import type { Uuid } from '../id/uuidv7';
import type { Konteringsmall } from './konteringsmall';

/**
 * Picking the template a receipt is probably for.
 *
 * The reverse of {@link sokMallar}, which matches one typed word against many
 * templates. Here there is a page of text and the question is which template
 * it mentions - so the matching runs the other way, and has to be stricter:
 * nobody checks a search result, but a suggestion that fills in a form is
 * trusted until it is wrong.
 *
 * No model and no training. The signal is the words the person themselves put
 * on their templates, ranked by how often they have used them, counted from
 * the device's own event log. Nothing about this needs data to leave the
 * device, which is the only kind of learning this project can have.
 */

/**
 * Shorter words match by accident.
 *
 * "Ab" appears on every Swedish receipt, and a template called "AB" would
 * then be suggested for all of them.
 */
const MINSTA_ORD = 4;

/**
 * Words printed on nearly every receipt, which therefore say nothing about
 * what was bought.
 *
 * The case that showed it: "Fått tillbaka moms" has the keyword "moms", and
 * every Swedish receipt says "Totalt inkl. moms". A receipt for salt licks
 * from a farm shop was offered as a moms refund from Skatteverket, because
 * nothing on it matched better. A keyword here still works where it means
 * something - typed into the search, or on a bank line - but not on a
 * receipt's text.
 */
const KVITTOORD = new Set([
  'moms',
  'totalt',
  'summa',
  'kvitto',
  'betala',
  'betalat',
  'kort',
  'kassa',
  'butik',
  'artikel',
  'antal',
  'pris',
  'rabatt',
  'retur',
  'debit',
  'kredit',
  'kontant',
  'kund',
  'order',
]);

export interface Mallforslag {
  readonly mall: Konteringsmall;
  /** The word on the receipt that matched, so the interface can say why. */
  readonly traff: string;
}

/**
 * The template whose name or keyword appears in the receipt's text.
 *
 * The longest match wins, because a longer word is a less likely accident:
 * "kraftfoder" on a receipt says more than "foder" does. Ties go to the
 * template that has been used most, and then to the alphabet, so the answer
 * does not depend on the order templates happen to be stored in.
 */
export function foreslaMallForText(
  mallar: readonly Konteringsmall[],
  text: string,
  anvandning: ReadonlyMap<Uuid, number> = new Map(),
): Mallforslag | undefined {
  const kvitto = normalisera(text);
  if (kvitto.length === 0) {
    return undefined;
  }

  let basta: { forslag: Mallforslag; langd: number; antal: number } | undefined;

  for (const mall of mallar) {
    const ord = [mall.namn, ...mall.sokord]
      .map(normalisera)
      .filter((kandidat) => kandidat.length >= MINSTA_ORD && !KVITTOORD.has(kandidat));

    for (const kandidat of ord) {
      if (!innehallerOrd(kvitto, kandidat)) {
        continue;
      }

      const antal = anvandning.get(mall.id) ?? 0;
      const battre =
        basta === undefined ||
        kandidat.length > basta.langd ||
        (kandidat.length === basta.langd &&
          (antal > basta.antal ||
            (antal === basta.antal &&
              mall.namn.localeCompare(basta.forslag.mall.namn, 'sv') < 0)));

      if (battre) {
        basta = { forslag: { mall, traff: kandidat }, langd: kandidat.length, antal };
      }
    }
  }

  return basta?.forslag;
}

/**
 * True when the word stands on its own in the text.
 *
 * A substring match would let "kaffe" match "kaffebryggare", which is a
 * different purchase on a different account. The boundary is anything that is
 * not a letter or a digit, so "foder," and "(foder)" still count - OCR
 * sprinkles punctuation where none was printed.
 */
function innehallerOrd(text: string, ord: string): boolean {
  let fran = 0;
  for (;;) {
    const index = text.indexOf(ord, fran);
    if (index === -1) {
      return false;
    }
    const fore = text[index - 1];
    const efter = text[index + ord.length];
    if (!arOrdtecken(fore) && !arOrdtecken(efter)) {
      return true;
    }
    fran = index + 1;
  }
}

function arOrdtecken(tecken: string | undefined): boolean {
  return tecken !== undefined && /[\p{L}\p{N}]/u.test(tecken);
}

function normalisera(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
