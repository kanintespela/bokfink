import type { Bokprofil } from '../bok/bokprofil';
import { BESLUTSTRAD, BETALSATTSNAMN, type Fraga } from './beslutstrad';
import { FORENINGSTRAD } from './foreningstrad';
import { kontonummer, type Kontonummer } from '../konto/konto';

/** The booking questions a book of this kind starts with. */
export function beslutstradFor(profil: Bokprofil): Fraga {
  return profil === 'forening' ? FORENINGSTRAD : BESLUTSTRAD;
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
