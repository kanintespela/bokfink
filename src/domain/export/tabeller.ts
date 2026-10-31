import { negate, ZERO, type Ore } from '../belopp/ore';
import type { Konto, Kontonummer } from '../konto/konto';
import type { Projektutdrag } from '../projekt/projektutdrag';
import type { Balansrakning } from '../rapport/balansrakning';
import type { Resultatrakning } from '../rapport/resultatrakning';
import type { Kontosaldo } from '../rapport/saldon';
import { beteckning, type BokfortVerifikat } from '../verifikat/verifikat';
import { belopp, type Falt } from './csv';

/**
 * The reports as tables, which is what leaves the app.
 *
 * One shape for every destination: a CSV file, a JSON document, and whatever
 * a spreadsheet is asked to do with them. Building the rows once means the
 * three cannot disagree about what a report contains, in the same way the
 * balances are computed once for the report and the SIE export.
 *
 * Debit and credit get a column each rather than one signed amount. That is
 * how a bookkeeping export is read by everyone who will receive one, and a
 * minus sign in a column headed "Belopp" is the kind of thing that gets
 * misread once and then trusted.
 */
export type Tabell = readonly (readonly Falt[])[];

/** Every verifikat with every posting under it, in number order. */
export function verifikationslistaTabell(
  verifikat: readonly BokfortVerifikat[],
  konton: ReadonlyMap<Kontonummer, Konto>,
): Tabell {
  const rader: Falt[][] = [
    ['Verifikat', 'Datum', 'Beskrivning', 'Konto', 'Kontonamn', 'Debet', 'Kredit'],
  ];

  for (const post of [...verifikat].sort(iNummerordning)) {
    for (const rad of post.konteringar) {
      rader.push([
        beteckning(post),
        post.datum,
        post.beskrivning,
        rad.konto,
        konton.get(rad.konto)?.namn ?? '',
        ...debetKredit(rad.belopp),
      ]);
    }
  }

  return rader;
}

/**
 * The huvudbok: every account that moved, with its opening balance, its
 * postings and where it ended.
 *
 * The account's own rows are written under it rather than in a column of
 * their own, because that is what makes the file readable as a ledger - and
 * a spreadsheet can filter on the account column either way.
 */
export function huvudbokTabell(
  saldon: ReadonlyMap<Kontonummer, Kontosaldo>,
  verifikat: readonly BokfortVerifikat[],
  konton: ReadonlyMap<Kontonummer, Konto>,
): Tabell {
  const rader: Falt[][] = [
    [
      'Konto',
      'Kontonamn',
      'Verifikat',
      'Datum',
      'Beskrivning',
      'Debet',
      'Kredit',
      'Saldo',
    ],
  ];

  const ordnade = [...saldon.values()].sort((a, b) => a.konto.localeCompare(b.konto));

  for (const saldo of ordnade) {
    const namn = konton.get(saldo.konto)?.namn ?? '';
    rader.push([
      saldo.konto,
      namn,
      '',
      '',
      'Ingående balans',
      undefined,
      undefined,
      belopp(saldo.ingaende),
    ]);

    let lopande = saldo.ingaende;
    for (const post of [...verifikat].sort(iNummerordning)) {
      for (const rad of post.konteringar) {
        if (rad.konto !== saldo.konto) {
          continue;
        }
        lopande = (lopande + rad.belopp) as Ore;
        rader.push([
          saldo.konto,
          namn,
          beteckning(post),
          post.datum,
          post.beskrivning,
          ...debetKredit(rad.belopp),
          belopp(lopande),
        ]);
      }
    }

    rader.push([
      saldo.konto,
      namn,
      '',
      '',
      'Utgående balans',
      undefined,
      undefined,
      belopp(saldo.utgaende),
    ]);
  }

  return rader;
}

/**
 * One project's rader out of the huvudbok, and what they add up to.
 *
 * The rader come first, as in the huvudbok; the sums follow with their own
 * label in the last column, so that a spreadsheet can filter the rader on the
 * account columns and the sums stay out of the way. Every rad carries the
 * project's code, for a recipient who puts several projects in one sheet.
 */
export function projektutdragTabell(
  utdrag: Projektutdrag,
  konton: ReadonlyMap<Kontonummer, Konto>,
): Tabell {
  const kod = utdrag.projekt.kod;
  const rader: Falt[][] = [
    [
      'Projekt',
      'Datum',
      'Verifikat',
      'Konto',
      'Kontonamn',
      'Beskrivning',
      'Debet',
      'Kredit',
      'Summa',
    ],
  ];

  for (const rad of utdrag.rader) {
    rader.push([
      kod,
      rad.datum,
      beteckning(rad.verifikat),
      rad.konto,
      konton.get(rad.konto)?.namn ?? '',
      rad.text,
      ...debetKredit(rad.belopp),
      undefined,
    ]);
  }

  const summa = (beskrivning: string, varde: Ore) =>
    rader.push([kod, '', '', '', '', beskrivning, undefined, undefined, belopp(varde)]);
  summa('Intäkter', utdrag.summaIntakter);
  summa('Kostnader', utdrag.summaKostnader);
  summa('Finansiella poster', utdrag.summaFinansiella);
  summa('Resultat', utdrag.resultat);
  summa('Tillgångar på projektet', utdrag.summaTillgangar);
  summa('Skuld kvar på projektet', utdrag.summaSkulder);

  return rader;
}

/** The income statement, group by group, with its subtotals. */
export function resultatrakningTabell(rapport: Resultatrakning): Tabell {
  const rader: Falt[][] = [['Rubrik', 'Konto', 'Kontonamn', 'Belopp']];

  for (const grupp of rapport.grupper) {
    for (const post of grupp.poster) {
      rader.push([grupp.rubrik, post.konto, post.namn, belopp(post.belopp)]);
    }
    rader.push([`Summa ${grupp.rubrik.toLowerCase()}`, '', '', belopp(grupp.summa)]);
  }

  rader.push(['Rörelseresultat', '', '', belopp(rapport.rorelseresultat)]);
  rader.push(['Periodens resultat', '', '', belopp(rapport.aretsResultat)]);
  return rader;
}

/** The balance sheet, both sides, with the result carried as its own line. */
export function balansrakningTabell(rapport: Balansrakning): Tabell {
  const rader: Falt[][] = [['Sida', 'Rubrik', 'Konto', 'Kontonamn', 'Belopp']];

  for (const grupp of rapport.tillgangar) {
    for (const post of grupp.poster) {
      rader.push([
        'Tillgångar',
        grupp.rubrik,
        post.konto,
        post.namn,
        belopp(post.belopp),
      ]);
    }
  }
  rader.push(['Tillgångar', 'Summa tillgångar', '', '', belopp(rapport.summaTillgangar)]);

  for (const grupp of rapport.egetKapitalOchSkulder) {
    for (const post of grupp.poster) {
      rader.push([
        'Eget kapital och skulder',
        grupp.rubrik,
        post.konto,
        post.namn,
        belopp(post.belopp),
      ]);
    }
  }
  rader.push([
    'Eget kapital och skulder',
    'Periodens resultat',
    '',
    '',
    belopp(rapport.aretsResultat),
  ]);
  rader.push([
    'Eget kapital och skulder',
    'Summa eget kapital och skulder',
    '',
    '',
    belopp(rapport.summaEgetKapitalOchSkulder),
  ]);

  return rader;
}

/**
 * A table as JSON: the header row becomes the keys.
 *
 * The same rows, so a JSON export cannot say something different from the CSV
 * beside it. Amounts are written as whole öre rather than as decimals -
 * anything reading JSON is a program, and a program that reads 520.31 has
 * already lost the öre to a float (hard rule 1).
 */
export function tillJson(tabell: Tabell): unknown[] {
  const [rubriker, ...rader] = tabell;
  if (rubriker === undefined) {
    return [];
  }

  return rader.map((rad) => {
    const post: Record<string, string | number | null> = {};
    rubriker.forEach((rubrik, index) => {
      const falt = rad[index];
      post[String(rubrik)] =
        falt === undefined
          ? null
          : typeof falt === 'object'
            ? falt.ore
            : typeof falt === 'number'
              ? falt
              : String(falt);
    });
    return post;
  });
}

/** The two columns a bookkeeping export is read in. */
function debetKredit(rad: Ore): [Falt, Falt] {
  return rad >= ZERO ? [belopp(rad), undefined] : [undefined, belopp(negate(rad))];
}

function iNummerordning(a: BokfortVerifikat, b: BokfortVerifikat): number {
  return a.serie === b.serie ? a.nummer - b.nummer : a.serie.localeCompare(b.serie);
}
