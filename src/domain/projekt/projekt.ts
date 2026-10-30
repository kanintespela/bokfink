import type { Uuid } from '../id/uuidv7';

/**
 * A project that konteringsrader can be booked on, so that what belongs to a
 * grant or an undertaking can be followed on its own.
 *
 * Only a code and a name. The code is what SIE calls the object number
 * (dimension 6, "Projekt") and is how the project is told apart in a file, so
 * it is fixed once given; the name and whether the project is over may change.
 */
export interface Projekt {
  readonly id: Uuid;
  readonly kod: string;
  readonly namn: string;
  /** A finished project takes no more bookings; what was booked on it stays. */
  readonly avslutat: boolean;
}

export class OgiltigtProjektError extends Error {
  constructor(meddelande: string) {
    super(meddelande);
    this.name = 'OgiltigtProjektError';
  }
}

/** Longest code and name, so a code fits a line in a file and a name a header. */
export const LANGSTA_PROJEKTKOD = 20;
export const LANGSTA_PROJEKTNAMN = 60;

/**
 * Letters, digits, dot, dash and underscore. A SIE object number is quoted
 * text, but a quote, a brace or a space in one is what other programs trip
 * over, so none is allowed in the first place.
 */
const KODTECKEN = /^[\p{L}\p{N}._-]+$/u;

export function projektkod(text: string): string {
  const kod = text.trim();
  if (kod.length === 0) {
    throw new OgiltigtProjektError('Ge projektet en kod, till exempel LEADER-28.');
  }
  if (kod.length > LANGSTA_PROJEKTKOD) {
    throw new OgiltigtProjektError(
      `Koden får vara högst ${LANGSTA_PROJEKTKOD} tecken lång.`,
    );
  }
  if (!KODTECKEN.test(kod)) {
    throw new OgiltigtProjektError(
      'Koden får bara innehålla bokstäver, siffror, punkt, bindestreck och understreck.',
    );
  }
  return kod;
}

export function projektnamn(text: string): string {
  const namn = text.trim().replace(/\s+/g, ' ');
  if (namn.length === 0) {
    throw new OgiltigtProjektError('Ge projektet ett namn.');
  }
  if (namn.length > LANGSTA_PROJEKTNAMN) {
    throw new OgiltigtProjektError(
      `Namnet får vara högst ${LANGSTA_PROJEKTNAMN} tecken långt.`,
    );
  }
  if (namn.includes('"')) {
    throw new OgiltigtProjektError('Namnet får inte innehålla citattecken.');
  }
  return namn;
}

export function skapaProjekt(uppgifter: {
  readonly id: Uuid;
  readonly kod: string;
  readonly namn: string;
}): Projekt {
  return {
    id: uppgifter.id,
    kod: projektkod(uppgifter.kod),
    namn: projektnamn(uppgifter.namn),
    avslutat: false,
  };
}

/**
 * The same project with a new name or finished or reopened. The code is not an
 * argument: it identifies the project in every file that has left the app.
 */
export function andraProjekt(
  projekt: Projekt,
  andring: { readonly namn?: string; readonly avslutat?: boolean },
): Projekt {
  return {
    ...projekt,
    ...(andring.namn === undefined ? {} : { namn: projektnamn(andring.namn) }),
    ...(andring.avslutat === undefined ? {} : { avslutat: andring.avslutat }),
  };
}

/** Whether another project already has this code, ignoring case. */
export function kodenFinns(kod: string, projekt: Iterable<Projekt>): boolean {
  const sokt = kod.trim().toLocaleLowerCase('sv');
  for (const post of projekt) {
    if (post.kod.toLocaleLowerCase('sv') === sokt) {
      return true;
    }
  }
  return false;
}
