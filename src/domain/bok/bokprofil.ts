/**
 * What kind of books a book is.
 *
 * An enskild firma and an ideell förening are kept under different rules -
 * BFNAR 2006:1 (K1) for the firm, BFNAR 2010:1 for the association - with
 * different accounts, a different year-end statement and no owner to draw
 * money out, so the profile decides which screens, accounts and reports a
 * book has. It is chosen when the book is created and never changed: a book
 * turned from one into the other would have verifikat booked under rules it
 * was not kept by, and hard rule 5 leaves no way to correct that afterwards.
 */
export const BOKPROFILER = ['enskild_firma', 'forening'] as const;

export type Bokprofil = (typeof BOKPROFILER)[number];

/**
 * The profile of every book that existed before there were two.
 *
 * Those books were all kept as an enskild firma, so a database that records
 * no profile is one.
 */
export const STANDARD_BOKPROFIL: Bokprofil = 'enskild_firma';

export const BOKPROFILNAMN: Record<Bokprofil, string> = {
  enskild_firma: 'Enskild firma',
  forening: 'Ideell förening',
};

/**
 * Reads a stored profile.
 *
 * Nothing stored is an old book and gets the standard. Something stored that
 * is not a profile this version knows - a backup made by a newer one - is an
 * error rather than a guess: treating an unknown kind of book as a firm would
 * show it the wrong accounts without a word (hard rule 11).
 */
export function tolkaBokprofil(varde: unknown): Bokprofil {
  if (varde === undefined) {
    return STANDARD_BOKPROFIL;
  }
  const profil = BOKPROFILER.find((kandidat) => kandidat === varde);
  if (profil === undefined) {
    throw new TypeError(
      `Boken har en profil som den här versionen av Bokfink inte känner till: ${String(varde)}. ` +
        'Uppdatera appen innan du öppnar den.',
    );
  }
  return profil;
}

/**
 * What a book can do beyond the bookkeeping every book has.
 *
 * Each of these belongs to the owner of an enskild firma and means nothing to
 * an association, which has no owner to draw money out and files no NE-bilaga.
 * A feature is listed here rather than tested for with `profil === ...` where
 * it is used, so the next profile has one place to say what it has.
 */
export type Profilfunktion =
  /** The NE-bilaga, the owner's part of the inkomstdeklaration. */
  | 'nebilaga'
  /** Egna uttag och insättningar (2013, 2017) and the owner's equity page. */
  | 'egnaUttag'
  /** The association's eget kapital, with the funds set aside inside it. */
  | 'foreningskapital'
  /** The year-end statement of BFNAR 2010:1, in the form of its bilaga 2. */
  | 'foreningsbokslut'
  /** The animal stock register. */
  | 'djurlager'
  /** The year-end statement for an enskild näringsidkare (BFNAR 2006:1, K1). */
  | 'k1Bokslut'
  /** The deadline for the owner's inkomstdeklaration with NE-bilaga. */
  | 'inkomstdeklarationsdag';

const FUNKTIONER: Record<Bokprofil, ReadonlySet<Profilfunktion>> = {
  enskild_firma: new Set<Profilfunktion>([
    'nebilaga',
    'egnaUttag',
    'djurlager',
    'k1Bokslut',
    'inkomstdeklarationsdag',
  ]),
  /*
   * An association is not under K1 (BFNAR 2010:1 applies) and does not file
   * the NE-bilaga: Skatteverket has it file Inkomstdeklaration 3. Its own
   * year-end statement comes with its own stage and shows up here when it
   * exists. Its equity page is BFNAR 2010:1 punkt 6.66-6.67.
   */
  forening: new Set<Profilfunktion>(['foreningskapital', 'foreningsbokslut']),
};

export function harFunktion(profil: Bokprofil, funktion: Profilfunktion): boolean {
  return FUNKTIONER[profil].has(funktion);
}

/**
 * Whether the book is registered for moms.
 *
 * A firm that keeps books in Bokfink is, as far as the app is built: the moms
 * screens, the declaration dates and the VAT accounts have always been there
 * for it. An association is not by default. Membership fees and grants carry
 * no moms, and a förening that is not registered cannot deduct the moms it
 * pays (Skatteverket, "Moms för ideella föreningar"), so the owner says
 * when it is - for example after choosing frivillig skattskyldighet for a
 * rented-out hall.
 */
export function arMomsregistrerad(
  profil: Bokprofil,
  uppgiven: boolean | undefined,
): boolean {
  return profil === 'enskild_firma' ? true : uppgiven === true;
}
