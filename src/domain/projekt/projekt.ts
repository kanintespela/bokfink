import type { Ore } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import { kontoklass, type Kontonummer } from '../konto/konto';
import type { Kontering } from '../verifikat/verifikat';

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
  /**
   * What the project is expected to take in and cost, account by account, for
   * the whole of it. Absent while none is set.
   */
  readonly budget?: readonly Budgetpost[];
}

/**
 * One line of a project's budget: an income or cost account and an amount.
 *
 * The amount is read the way the statement reads it - income and cost both as
 * positive amounts - so that a budget of 40 000 kr for material is compared
 * with 40 000 kr of material and not with a minus sign.
 */
export interface Budgetpost {
  readonly konto: Kontonummer;
  readonly belopp: Ore;
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
 * A budget as it is stored: lines for income and cost accounts, each once, in
 * account order. Class 3 is income and classes 4-7 are cost; financial items
 * (class 8) and the balance sheet are not budgeted per project.
 */
export function budgetposter(poster: readonly Budgetpost[]): Budgetpost[] {
  const sedda = new Set<Kontonummer>();
  for (const post of poster) {
    const klass = kontoklass(post.konto);
    if (klass < 3 || klass > 7) {
      throw new OgiltigtProjektError(
        `Konto ${post.konto} går inte att budgetera: en projektbudget gäller intäkter (klass 3) och kostnader (klass 4–7).`,
      );
    }
    if (post.belopp <= 0) {
      throw new OgiltigtProjektError(
        `Beloppet för konto ${post.konto} måste vara större än noll. Lämna bort kontot om det inte ska budgeteras.`,
      );
    }
    if (sedda.has(post.konto)) {
      throw new OgiltigtProjektError(`Konto ${post.konto} finns två gånger i budgeten.`);
    }
    sedda.add(post.konto);
  }
  return [...poster].sort((a, b) => a.konto.localeCompare(b.konto));
}

/**
 * The same project with a new name or finished or reopened. The code is not an
 * argument: it identifies the project in every file that has left the app.
 */
export function andraProjekt(
  projekt: Projekt,
  andring: {
    readonly namn?: string;
    readonly avslutat?: boolean;
    /** Replaces the whole budget; an empty one takes it away. */
    readonly budget?: readonly Budgetpost[];
  },
): Projekt {
  const andrat: Projekt = {
    ...projekt,
    ...(andring.namn === undefined ? {} : { namn: projektnamn(andring.namn) }),
    ...(andring.avslutat === undefined ? {} : { avslutat: andring.avslutat }),
  };
  if (andring.budget === undefined) {
    return andrat;
  }
  const utanBudget = Object.fromEntries(
    Object.entries(andrat).filter(([falt]) => falt !== 'budget'),
  ) as unknown as Projekt;
  const budget = budgetposter(andring.budget);
  return budget.length === 0 ? utanBudget : { ...utanBudget, budget };
}

/**
 * A project code made from an object number in another program's file.
 *
 * Other programs allow spaces, slashes and long numbers in an object number,
 * which a code here does not (see {@link projektkod}). What cannot stay is
 * written as a dash and the code is cut to length; nothing is left that has
 * to be guessed at. Undefined when nothing of the number is usable.
 */
export function projektkodFranSie(objektnummer: string): string | undefined {
  const kod = objektnummer
    .trim()
    .replaceAll(/[^\p{L}\p{N}._-]+/gu, '-')
    .replaceAll(/-{2,}/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, LANGSTA_PROJEKTKOD)
    .replaceAll(/-+$/g, '');
  return kod.length === 0 ? undefined : kod;
}

/** A project name from an object name in a file: without quotes, folded and cut to length. */
export function projektnamnFranSie(objektnamn: string, reserv: string): string {
  const namn = objektnamn
    .replaceAll('"', "'")
    .trim()
    .replaceAll(/\s+/g, ' ')
    .slice(0, LANGSTA_PROJEKTNAMN);
  return namn.length === 0 ? reserv : namn;
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

/**
 * The rows with the project set on those booked on one account.
 *
 * A template books a cost or an income together with its moms and the account
 * that paid, and only the first is what a project follows: the bank row would
 * put the whole payment on it and the moms row a cost that is not the
 * project's. The rows are otherwise left as they were.
 */
export function medProjektPaKonto(
  konteringar: readonly Kontering[],
  konto: Kontering['konto'],
  projekt: Uuid | undefined,
): Kontering[] {
  return konteringar.map((rad) =>
    projekt === undefined || rad.konto !== konto ? rad : { ...rad, projekt },
  );
}
