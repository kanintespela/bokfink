import type { Bokprofil } from '../bok/bokprofil';
import { BESLUTSTRAD, BETALSATTSNAMN, type Fraga } from './beslutstrad';
import { FORENINGSTRAD } from './foreningstrad';
import { kontonummer, type Kontonummer } from '../konto/konto';
import { STANDARD_BRANSCH, type Bransch } from '../bok/bransch';
import { anpassaTrad } from './bransch';

/**
 * The booking questions a book of this kind starts with.
 *
 * The trade only orders and words a firm's questions; an association has its
 * own and no trade.
 */
export function beslutstradFor(
  profil: Bokprofil,
  bransch: Bransch = STANDARD_BRANSCH,
): Fraga {
  return profil === 'forening' ? FORENINGSTRAD : anpassaTrad(BESLUTSTRAD, bransch);
}

const FORENINGENS_BETALSATTSNAMN: ReadonlyMap<Kontonummer, string> = new Map([
  [kontonummer('1930'), 'Bankkontot'],
  [kontonummer('1910'), 'Kassan'],
  [kontonummer('1940'), 'Placeringskontot'],
]);

/** What each payment account is called where it is offered. */
export function betalsattsnamnFor(profil: Bokprofil): ReadonlyMap<Kontonummer, string> {
  return profil === 'forening' ? FORENINGENS_BETALSATTSNAMN : BETALSATTSNAMN;
}
