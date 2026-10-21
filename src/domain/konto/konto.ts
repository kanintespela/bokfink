/**
 * A BAS account number: four digits, 1000 through 8999.
 *
 * Branded so a number that was never checked cannot be passed off as one that
 * was. Kept as a string rather than a number because leading position matters
 * and because it is what SIE, SRU and every report carry.
 */
export type Kontonummer = string & { readonly __brand: 'Kontonummer' };

/**
 * What an account does in the books.
 *
 * Finer than SIE's four #KTYP values, which fold equity and debt together
 * into "S". Enskild firma needs them apart: egna uttag and insättningar move
 * equity, and the balance sheet reports the two separately.
 */
export type Kontotyp = 'tillgang' | 'egetKapital' | 'skuld' | 'intakt' | 'kostnad';

export interface Konto {
  readonly nummer: Kontonummer;
  readonly namn: string;
  readonly typ: Kontotyp;
  /** Inactive accounts stay for history but are not offered when booking. */
  readonly aktiv: boolean;
  readonly favorit: boolean;
  /**
   * SRU codes, which map the account onto a box in the tax return.
   *
   * Carried rather than dropped because SIE files state them - 194 of the 299
   * accounts in the export this was built against - and the NE-bilaga needs
   * them. An import that discarded them would have to guess them back later,
   * and leaving Kontera is supposed to cost nothing.
   */
  readonly sru: readonly string[];
}

const NUMMER = /^[1-8]\d{3}$/;

export function kontonummer(text: string): Kontonummer {
  const trimmed = text.trim();
  if (!NUMMER.test(trimmed)) {
    throw new TypeError(
      `"${text}" är inte ett kontonummer. Ett BAS-konto har fyra siffror och ` +
        'ligger mellan 1000 och 8999.',
    );
  }
  return trimmed as Kontonummer;
}

/** The leading digit, 1 through 8. */
export function kontoklass(nummer: Kontonummer): number {
  return Number(nummer[0]);
}

/**
 * Works out what an account does from its number alone, for sources that do
 * not say.
 *
 * BAS reserves each leading digit for one kind of account: 1 assets, 2 equity
 * and liabilities, 3 operating income, 4 through 7 operating costs. Class 8
 * is the exception — it holds financial income and financial costs side by
 * side, so 8310 Ränteintäkter and 8410 Räntekostnader cannot be told apart by
 * their numbers.
 *
 * Returns undefined rather than guessing in that case. Guessing would put
 * interest income on the wrong side of the income statement, and a wrong
 * answer is worse than no answer for something a caller can supply.
 *
 * This exists because SIE exports are allowed to be incomplete: some
 * programs' files carry #KTYP for every account except class 2, so the case the import
 * actually depends on is the one this can answer with certainty.
 */
export function harledKontotyp(nummer: Kontonummer): Kontotyp | undefined {
  const klass = kontoklass(nummer);

  if (klass === 1) {
    return 'tillgang';
  }
  if (klass === 2) {
    /*
     * BAS kontogrupp 20 is Eget kapital. Everything above it in the class is
     * untaxed reserves, provisions and debt, all of which the balance sheet
     * reports away from equity.
     */
    return Number(nummer) < 2100 ? 'egetKapital' : 'skuld';
  }
  if (klass === 3) {
    return 'intakt';
  }
  if (klass >= 4 && klass <= 7) {
    return 'kostnad';
  }
  return undefined;
}

/** True for accounts that carry a balance across the year end. */
export function arBalanskonto(typ: Kontotyp): boolean {
  return typ === 'tillgang' || typ === 'egetKapital' || typ === 'skuld';
}

/** True for accounts that are closed out into the year's result. */
export function arResultatkonto(typ: Kontotyp): boolean {
  return !arBalanskonto(typ);
}

export interface Kontoutkast {
  readonly nummer: string;
  readonly namn: string;
  readonly typ?: Kontotyp;
  readonly aktiv?: boolean;
  readonly favorit?: boolean;
  readonly sru?: readonly string[];
}

/**
 * Validates an account and fills in what can be filled in.
 *
 * Leaving out the type asks for it to be derived, which fails loudly for
 * class 8 rather than silently choosing a side.
 */
export function skapaKonto(utkast: Kontoutkast): Konto {
  const nummer = kontonummer(utkast.nummer);
  const namn = utkast.namn.trim();

  if (namn.length === 0) {
    throw new TypeError(`Konto ${nummer} måste ha ett namn.`);
  }

  const typ = utkast.typ ?? harledKontotyp(nummer);
  if (typ === undefined) {
    throw new TypeError(
      `Kontotypen för ${nummer} går inte att härleda ur kontonumret, eftersom ` +
        'kontoklass 8 rymmer både finansiella intäkter och finansiella ' +
        'kostnader. Ange den uttryckligen.',
    );
  }

  return {
    nummer,
    namn,
    typ,
    aktiv: utkast.aktiv ?? true,
    favorit: utkast.favorit ?? false,
    sru: [...(utkast.sru ?? [])],
  };
}
