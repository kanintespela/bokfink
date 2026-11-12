/**
 * What a firm does, as far as the booking questions are concerned.
 *
 * It decides nothing about the bookkeeping: every answer is on every firm's
 * list, and every account is booked the same way whatever the trade. It only
 * decides which answers come first and what they are called, so that someone
 * who sells advice does not scroll past animals to reach a telephone bill.
 * That is also why a wrong choice costs nothing and can be changed any time
 * under Mer, Företaget.
 */
export const BRANSCHER = ['gard', 'tjanster', 'hantverk', 'handel', 'annat'] as const;

export type Bransch = (typeof BRANSCHER)[number];

export const BRANSCHNAMN: Record<Bransch, string> = {
  gard: 'Gård eller djurhållning',
  tjanster: 'Tjänster eller konsult',
  hantverk: 'Hantverk eller bygg',
  handel: 'Handel med varor',
  annat: 'Annat',
};

/**
 * What a book with no recorded trade is.
 *
 * The questions were written for a farm, and every book made before the trade
 * could be chosen has used them, so those keep the order they are used to.
 */
export const STANDARD_BRANSCH: Bransch = 'gard';

/**
 * Reads a stored trade.
 *
 * Nothing stored is an older book. Something stored that this version does not
 * know - from a newer one - becomes "annat": the answers are all there either
 * way, so showing them in a neutral order is a fair reading, not a guess about
 * the bookkeeping.
 */
export function tolkaBransch(varde: unknown): Bransch {
  if (varde === undefined) {
    return STANDARD_BRANSCH;
  }
  return BRANSCHER.find((kandidat) => kandidat === varde) ?? 'annat';
}
