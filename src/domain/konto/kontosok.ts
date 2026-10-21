import type { Konto } from './konto';

/**
 * Finds accounts by number or by what they are called.
 *
 * Someone booking by hand knows what the money is - "ingående moms", "bank",
 * "ränta" - far more often than the four digits BAS gave it. Every word typed
 * has to be found, in the number or the name, so "moms ing" narrows as well
 * as "ingående moms" does. A number typed from its start ranks first, then a
 * name that starts with what was typed, then names where each word starts a
 * word, then anything else that contains it. Favourites break ties, then the
 * account number.
 *
 * Empty input finds nothing: a list of three hundred accounts is not an
 * answer to a question nobody asked.
 */
export function sokKonton(konton: readonly Konto[], fraga: string): Konto[] {
  const sokt = normalisera(fraga);
  if (sokt.length === 0) {
    return [];
  }
  const ord = sokt.split(/\s+/);

  return konton
    .map((konto) => ({ konto, poang: poangsatt(konto, sokt, ord) }))
    .filter((post) => post.poang > 0)
    .sort((a, b) => {
      if (a.poang !== b.poang) {
        return b.poang - a.poang;
      }
      if (a.konto.favorit !== b.konto.favorit) {
        return a.konto.favorit ? -1 : 1;
      }
      return a.konto.nummer.localeCompare(b.konto.nummer);
    })
    .map((post) => post.konto);
}

function poangsatt(konto: Konto, sokt: string, ord: readonly string[]): number {
  if (konto.nummer.startsWith(sokt)) return 100;

  const namn = normalisera(konto.namn);
  if (namn.startsWith(sokt)) return 80;

  const namnord = namn.split(/[^\p{L}\p{N}]+/u).filter((del) => del.length > 0);
  const traffar = ord.map((del) => {
    if (konto.nummer.startsWith(del)) return 'borjan';
    if (namnord.some((ordet) => ordet.startsWith(del))) return 'borjan';
    if (namn.includes(del)) return 'inuti';
    return undefined;
  });

  if (traffar.some((traff) => traff === undefined)) return 0;
  if (traffar.every((traff) => traff === 'borjan')) return 60;
  return 40;
}

/**
 * Folds case and accents, so that "ingaende" finds "Ingående".
 *
 * The same folding as template and verifikat search: typing å, ä or ö costs
 * a keystroke on a phone keyboard, and someone in a hurry will not spend it.
 */
function normalisera(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
