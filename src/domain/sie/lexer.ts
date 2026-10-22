/** One line of a SIE file, split into its label and its fields. */
export interface Siepost {
  /** The label without its leading #, e.g. "KONTO". */
  readonly etikett: string;
  readonly falt: readonly string[];
  /** 1-based, for error messages that point at the file. */
  readonly rad: number;
  /** How deep inside #VER's braces this record sits. 0 is top level. */
  readonly niva: number;
}

export class SiesyntaxError extends Error {
  constructor(rad: number, orsak: string) {
    super(`Rad ${rad} i SIE-filen går inte att tolka: ${orsak}`);
    this.name = 'SiesyntaxError';
  }
}

/**
 * Splits a SIE file into records.
 *
 * The format is one record per line: a #LABEL followed by space-separated
 * fields. A field is quoted when it contains spaces, `{...}` when it is a
 * list of dimensions, and bare otherwise. Verifikat wrap their #TRANS lines
 * in braces on lines of their own, which is what `niva` tracks.
 *
 * Unknown labels are kept rather than dropped. SIE files carry sections this
 * program has no use for, and a reader that silently discarded them would
 * make an export that quietly lost data look like a successful round trip.
 */
export function laseSie(text: string): Siepost[] {
  const poster: Siepost[] = [];
  let niva = 0;

  const rader = text.split(/\r\n|\r|\n/);

  for (const [index, ravRad] of rader.entries()) {
    const radnummer = index + 1;
    const rad = ravRad.trim();

    if (rad.length === 0) {
      continue;
    }

    if (rad === '{') {
      niva += 1;
      continue;
    }

    if (rad === '}') {
      if (niva === 0) {
        throw new SiesyntaxError(radnummer, 'en avslutande } saknar sin början.');
      }
      niva -= 1;
      continue;
    }

    if (!rad.startsWith('#')) {
      throw new SiesyntaxError(
        radnummer,
        `varje post ska börja med #, men raden börjar med "${rad.slice(0, 12)}".`,
      );
    }

    const falt = delaFalt(rad, radnummer);
    const etikett = falt[0]?.slice(1) ?? '';
    if (etikett.length === 0) {
      throw new SiesyntaxError(radnummer, 'posten saknar etikett efter #.');
    }

    poster.push({ etikett, falt: falt.slice(1), rad: radnummer, niva });
  }

  if (niva !== 0) {
    throw new SiesyntaxError(rader.length, 'filen slutar med en oavslutad {.');
  }

  return poster;
}

function delaFalt(rad: string, radnummer: number): string[] {
  const falt: string[] = [];
  let i = 0;

  while (i < rad.length) {
    const tecken = rad.charAt(i);

    if (tecken === ' ' || tecken === '\t') {
      i += 1;
      continue;
    }

    if (tecken === '"') {
      let varde = '';
      i += 1;
      while (i < rad.length && rad.charAt(i) !== '"') {
        // A backslash escapes the next character, which is how a quotation
        // mark gets inside a description.
        if (rad.charAt(i) === '\\' && i + 1 < rad.length) {
          varde += rad.charAt(i + 1);
          i += 2;
          continue;
        }
        varde += rad.charAt(i);
        i += 1;
      }
      if (i >= rad.length) {
        throw new SiesyntaxError(radnummer, 'ett citattecken öppnas men stängs aldrig.');
      }
      i += 1;
      falt.push(varde);
      continue;
    }

    if (tecken === '{') {
      const slut = rad.indexOf('}', i);
      if (slut === -1) {
        throw new SiesyntaxError(radnummer, 'en { öppnas men stängs aldrig på raden.');
      }
      falt.push(rad.slice(i, slut + 1));
      i = slut + 1;
      continue;
    }

    let slut = i;
    while (slut < rad.length && !' \t'.includes(rad.charAt(slut))) {
      slut += 1;
    }
    falt.push(rad.slice(i, slut));
    i = slut;
  }

  return falt;
}
