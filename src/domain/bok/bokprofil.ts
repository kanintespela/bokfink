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
