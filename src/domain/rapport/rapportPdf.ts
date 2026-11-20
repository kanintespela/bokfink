import type { PDFFont } from 'pdf-lib';

import { formatKronor, isZero, negate, type Ore } from '../belopp/ore';
import type { Konto, Kontonummer } from '../konto/konto';
import type { Datum } from '../tid/datum';
import { beteckning, type BokfortVerifikat } from '../verifikat/verifikat';
import type { Balansrakning } from './balansrakning';
import { kontoutdrag } from './kontoutdrag';
import type { Resultatrakning } from './resultatrakning';
import type { Kontosaldo } from './saldon';

/**
 * Resultaträkning, balansräkning and huvudbok as PDF, for the person who is
 * handed the books and has no Bokfink - a board, an auditor, a bank.
 *
 * The figures come in already computed, by the same functions the screens
 * use, so a page cannot disagree with what was on screen when it was saved.
 * This file only decides where things go on the sheet.
 *
 * Helvetica's built-in WinAnsi encoding covers å, ä and ö, so no font is
 * embedded. A letter it lacks is written as a question mark rather than
 * stopping the document, as in the verifikationslista.
 */

const SIDBREDD = 595.28; // A4, in points.
const SIDHOJD = 841.89;
const MARGINAL = 50;
const HOGER = SIDBREDD - MARGINAL;
const RADHOJD = 13;
const TEXTSTORLEK = 9;
const RUBRIKSTORLEK = 16;
const SIDFOTSTORLEK = 8;

export interface Period {
  readonly fran: Datum;
  readonly till: Datum;
}

interface Jamforelse<T> {
  /** What the comparison period is called in the column heading. */
  readonly namn: string;
  readonly rapport: T;
}

export interface ResultatPdfUppgifter {
  readonly foretagsnamn: string;
  readonly period: Period;
  readonly rapport: Resultatrakning;
  readonly jamforelse?: Jamforelse<Resultatrakning>;
  /** When the PDF says it was produced. Domain has no clock; this is it. */
  readonly skapad: Datum;
}

export interface BalansPdfUppgifter {
  readonly foretagsnamn: string;
  readonly period: Period;
  readonly rapport: Balansrakning;
  readonly jamforelse?: Jamforelse<Balansrakning>;
  readonly skapad: Datum;
}

export interface HuvudbokPdfUppgifter {
  readonly foretagsnamn: string;
  readonly period: Period;
  readonly saldon: ReadonlyMap<Kontonummer, Kontosaldo>;
  readonly verifikat: readonly BokfortVerifikat[];
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly skapad: Datum;
}

interface Textval {
  readonly fet?: boolean;
  readonly storlek?: number;
}

/**
 * The page machinery shared by the three reports: fonts, page breaks, text
 * that cannot make the document fail, and the footer with page numbers.
 */
async function oppnaBlad(
  titel: string,
  foretagsnamn: string,
  undertexter: readonly string[],
  skapad: Datum,
) {
  // Imported here, not at the top: a few hundred kilobytes nobody should pay
  // for by opening the app, for a document only asked for on request.
  const { PDFDocument, StandardFonts } = await import('pdf-lib');

  const dokument = await PDFDocument.create();
  dokument.setTitle(`${titel} – ${foretagsnamn}`);
  const font = await dokument.embedFont(StandardFonts.Helvetica);
  const fetFont = await dokument.embedFont(StandardFonts.HelveticaBold);

  let sida = dokument.addPage([SIDBREDD, SIDHOJD]);
  let y = SIDHOJD - MARGINAL;
  let paNySida: (() => void) | undefined;

  const kanSkrivas = new Set(font.getCharacterSet());
  const rensa = (text: string): string =>
    [...text]
      .map((tecken) => (kanSkrivas.has(tecken.codePointAt(0)!) ? tecken : '?'))
      .join('');

  const valFont = (val: Textval): PDFFont => (val.fet === true ? fetFont : font);

  function skriv(text: string, x: number, val: Textval = {}): void {
    sida.drawText(rensa(text), {
      x,
      y,
      size: val.storlek ?? TEXTSTORLEK,
      font: valFont(val),
    });
  }

  /** Text that ends at `xHoger`, which is how a column of amounts lines up. */
  function skrivHoger(text: string, xHoger: number, val: Textval = {}): void {
    const rent = rensa(text);
    const bredd = valFont(val).widthOfTextAtSize(rent, val.storlek ?? TEXTSTORLEK);
    sida.drawText(rent, {
      x: xHoger - bredd,
      y,
      size: val.storlek ?? TEXTSTORLEK,
      font: valFont(val),
    });
  }

  /** Cuts a text to fit a column; a long description must not run into the amounts. */
  function beskuren(text: string, bredd: number, val: Textval = {}): string {
    const rent = rensa(text);
    const f = valFont(val);
    const storlek = val.storlek ?? TEXTSTORLEK;
    if (f.widthOfTextAtSize(rent, storlek) <= bredd) {
      return rent;
    }
    let kortad = rent;
    while (kortad.length > 1 && f.widthOfTextAtSize(`${kortad}...`, storlek) > bredd) {
      kortad = kortad.slice(0, -1);
    }
    return `${kortad}...`;
  }

  function nastaRad(antal = 1): void {
    y -= RADHOJD * antal;
  }

  /** Starts a fresh page when the next block would not fit on this one. */
  function plats(rader: number): void {
    if (y - RADHOJD * rader < MARGINAL + 10) {
      sida = dokument.addPage([SIDBREDD, SIDHOJD]);
      y = SIDHOJD - MARGINAL;
      paNySida?.();
    }
  }

  skriv(`${titel} — ${foretagsnamn}`, MARGINAL, { fet: true, storlek: RUBRIKSTORLEK });
  y -= RUBRIKSTORLEK + 2;
  for (const rad of undertexter) {
    skriv(rad, MARGINAL);
    nastaRad();
  }
  skriv(`Skapad ${skapad}`, MARGINAL);
  nastaRad(2);

  return {
    skriv,
    skrivHoger,
    beskuren,
    nastaRad,
    plats,
    /** What to draw again at the top of every page after the first. */
    vidNySida(atgard: () => void): void {
      paNySida = atgard;
    },
    async spara(): Promise<Uint8Array> {
      const sidor = dokument.getPages();
      sidor.forEach((blad, index) => {
        blad.drawText(rensa(`${foretagsnamn} · ${titel} · Skapad ${skapad}`), {
          x: MARGINAL,
          y: 28,
          size: SIDFOTSTORLEK,
          font,
        });
        const sidtext = `Sida ${index + 1} av ${sidor.length}`;
        blad.drawText(sidtext, {
          x: HOGER - font.widthOfTextAtSize(sidtext, SIDFOTSTORLEK),
          y: 28,
          size: SIDFOTSTORLEK,
          font,
        });
      });
      return dokument.save();
    },
  };
}

type Blad = Awaited<ReturnType<typeof oppnaBlad>>;

/** Every account's amount, by number, for looking up the comparison figure. */
function beloppPerKonto(
  grupper: readonly {
    readonly poster: readonly { readonly konto: Kontonummer; readonly belopp: Ore }[];
  }[],
): ReadonlyMap<Kontonummer, Ore> {
  return new Map(
    grupper.flatMap((grupp) => grupp.poster.map((post) => [post.konto, post.belopp])),
  );
}

function summorPerRubrik(
  grupper: readonly { readonly rubrik: string; readonly summa: Ore }[],
): ReadonlyMap<string, Ore> {
  return new Map(grupper.map((grupp) => [grupp.rubrik, grupp.summa]));
}

/** The two amount columns' right edges: one when there is nothing to compare with. */
function beloppkolumner(medJamforelse: boolean): {
  readonly nu: number;
  readonly fore: number | undefined;
} {
  return medJamforelse ? { nu: HOGER - 80, fore: HOGER } : { nu: HOGER, fore: undefined };
}

interface Radgrupp {
  readonly rubrik: string;
  readonly summa: Ore;
  readonly poster: readonly {
    readonly konto: Kontonummer;
    readonly namn: string;
    readonly belopp: Ore;
  }[];
}

function skrivGrupper(
  blad: Blad,
  grupper: readonly Radgrupp[],
  kolumner: ReturnType<typeof beloppkolumner>,
  tidigarePost: ReadonlyMap<Kontonummer, Ore> | undefined,
  tidigareSumma: ReadonlyMap<string, Ore> | undefined,
): void {
  for (const grupp of grupper) {
    blad.plats(3);
    blad.skriv(grupp.rubrik, MARGINAL, { fet: true });
    blad.nastaRad();
    for (const post of grupp.poster) {
      blad.plats(1);
      blad.skriv(post.konto, MARGINAL);
      blad.skriv(blad.beskuren(post.namn, kolumner.nu - 160), MARGINAL + 45);
      blad.skrivHoger(formatKronor(post.belopp), kolumner.nu);
      const fore = tidigarePost?.get(post.konto);
      if (kolumner.fore !== undefined && fore !== undefined) {
        blad.skrivHoger(formatKronor(fore), kolumner.fore);
      }
      blad.nastaRad();
    }
    blad.plats(1);
    blad.skriv(`Summa ${grupp.rubrik.toLowerCase()}`, MARGINAL + 45, { fet: true });
    blad.skrivHoger(formatKronor(grupp.summa), kolumner.nu, { fet: true });
    const forePost = tidigareSumma?.get(grupp.rubrik);
    if (kolumner.fore !== undefined && forePost !== undefined) {
      blad.skrivHoger(formatKronor(forePost), kolumner.fore, { fet: true });
    }
    blad.nastaRad(2);
  }
}

function skrivSumma(
  blad: Blad,
  namn: string,
  belopp: Ore,
  kolumner: ReturnType<typeof beloppkolumner>,
  tidigare?: Ore,
): void {
  blad.plats(2);
  blad.skriv(namn, MARGINAL, { fet: true });
  blad.skrivHoger(formatKronor(belopp), kolumner.nu, { fet: true });
  if (kolumner.fore !== undefined && tidigare !== undefined) {
    blad.skrivHoger(formatKronor(tidigare), kolumner.fore, { fet: true });
  }
  blad.nastaRad(2);
}

function skrivKolumnrubriker(
  blad: Blad,
  kolumner: ReturnType<typeof beloppkolumner>,
  jamforelsenamn: string | undefined,
): void {
  if (kolumner.fore !== undefined && jamforelsenamn !== undefined) {
    blad.skrivHoger('Period', kolumner.nu, { fet: true });
    blad.skrivHoger(blad.beskuren(jamforelsenamn, 75, { fet: true }), kolumner.fore, {
      fet: true,
    });
    blad.nastaRad();
  }
}

function undertexter(period: Period, jamforelsenamn: string | undefined): string[] {
  return [
    `Period ${period.fran} – ${period.till}`,
    ...(jamforelsenamn === undefined ? [] : [`Jämförs med ${jamforelsenamn}`]),
  ];
}

export async function skrivResultatPdf(
  uppgifter: ResultatPdfUppgifter,
): Promise<Uint8Array> {
  const { rapport, jamforelse } = uppgifter;
  const blad = await oppnaBlad(
    'Resultaträkning',
    uppgifter.foretagsnamn,
    undertexter(uppgifter.period, jamforelse?.namn),
    uppgifter.skapad,
  );
  const kolumner = beloppkolumner(jamforelse !== undefined);

  blad.vidNySida(() => skrivKolumnrubriker(blad, kolumner, jamforelse?.namn));
  skrivKolumnrubriker(blad, kolumner, jamforelse?.namn);
  skrivGrupper(
    blad,
    rapport.grupper,
    kolumner,
    jamforelse === undefined ? undefined : beloppPerKonto(jamforelse.rapport.grupper),
    jamforelse === undefined ? undefined : summorPerRubrik(jamforelse.rapport.grupper),
  );
  skrivSumma(
    blad,
    'Rörelseresultat',
    rapport.rorelseresultat,
    kolumner,
    jamforelse?.rapport.rorelseresultat,
  );
  skrivSumma(
    blad,
    'Periodens resultat',
    rapport.aretsResultat,
    kolumner,
    jamforelse?.rapport.aretsResultat,
  );

  return blad.spara();
}

export async function skrivBalansPdf(uppgifter: BalansPdfUppgifter): Promise<Uint8Array> {
  const { rapport, jamforelse } = uppgifter;
  const blad = await oppnaBlad(
    'Balansräkning',
    uppgifter.foretagsnamn,
    undertexter(uppgifter.period, jamforelse?.namn),
    uppgifter.skapad,
  );
  const kolumner = beloppkolumner(jamforelse !== undefined);
  const tidigare = jamforelse?.rapport;

  blad.vidNySida(() => skrivKolumnrubriker(blad, kolumner, jamforelse?.namn));
  skrivKolumnrubriker(blad, kolumner, jamforelse?.namn);

  const post =
    tidigare === undefined
      ? undefined
      : beloppPerKonto([...tidigare.tillgangar, ...tidigare.egetKapitalOchSkulder]);
  const summor =
    tidigare === undefined
      ? undefined
      : summorPerRubrik([...tidigare.tillgangar, ...tidigare.egetKapitalOchSkulder]);

  skrivGrupper(blad, rapport.tillgangar, kolumner, post, summor);
  skrivSumma(
    blad,
    'Summa tillgångar',
    rapport.summaTillgangar,
    kolumner,
    tidigare?.summaTillgangar,
  );
  skrivGrupper(blad, rapport.egetKapitalOchSkulder, kolumner, post, summor);
  skrivSumma(
    blad,
    'Periodens resultat',
    rapport.aretsResultat,
    kolumner,
    tidigare?.aretsResultat,
  );
  skrivSumma(
    blad,
    'Summa eget kapital och skulder',
    rapport.summaEgetKapitalOchSkulder,
    kolumner,
    tidigare?.summaEgetKapitalOchSkulder,
  );

  if (!isZero(rapport.differens)) {
    blad.plats(2);
    blad.skriv(
      `Balansräkningen går inte ihop: ${formatKronor(rapport.differens)} skiljer mellan sidorna.`,
      MARGINAL,
      { fet: true },
    );
    blad.nastaRad();
    blad.skriv('Det betyder att något är fel i bokföringen, inte i rapporten.', MARGINAL);
  }

  return blad.spara();
}

// Columns of the huvudbok, as the right edge of each amount.
const HB_DEBET = 365;
const HB_KREDIT = 432;
const HB_SALDO = HOGER;

export async function skrivHuvudbokPdf(
  uppgifter: HuvudbokPdfUppgifter,
): Promise<Uint8Array> {
  const blad = await oppnaBlad(
    'Huvudbok',
    uppgifter.foretagsnamn,
    undertexter(uppgifter.period, undefined),
    uppgifter.skapad,
  );

  // The same accounts the screen lists: those with a balance or a movement.
  const konton = [...uppgifter.saldon.values()]
    .filter((saldo) => !(isZero(saldo.ingaende) && isZero(saldo.forandring)))
    .sort((a, b) => a.konto.localeCompare(b.konto));

  if (konton.length === 0) {
    blad.skriv('Inget konto har rört sig i det här räkenskapsåret.', MARGINAL);
    return blad.spara();
  }

  const kolumnrubriker = (): void => {
    blad.skriv('Datum', MARGINAL, { fet: true });
    blad.skriv('Ver.', MARGINAL + 55, { fet: true });
    blad.skriv('Text', MARGINAL + 95, { fet: true });
    blad.skrivHoger('Debet', HB_DEBET, { fet: true });
    blad.skrivHoger('Kredit', HB_KREDIT, { fet: true });
    blad.skrivHoger('Saldo', HB_SALDO, { fet: true });
    blad.nastaRad();
  };
  blad.vidNySida(kolumnrubriker);
  kolumnrubriker();

  for (const saldo of konton) {
    const utdrag = kontoutdrag(saldo.konto, saldo.ingaende, uppgifter.verifikat);
    const namn = uppgifter.konton.get(saldo.konto)?.namn ?? '';

    // The heading and the opening line stay together.
    blad.plats(3);
    blad.skriv(`${saldo.konto} ${namn}`, MARGINAL, { fet: true });
    blad.nastaRad();
    blad.skriv('Ingående balans', MARGINAL + 95);
    blad.skrivHoger(formatKronor(utdrag.ingaende), HB_SALDO);
    blad.nastaRad();

    for (const rad of utdrag.rader) {
      blad.plats(1);
      blad.skriv(rad.datum, MARGINAL);
      blad.skriv(beteckning(rad.verifikat), MARGINAL + 55);
      blad.skriv(blad.beskuren(rad.text, HB_DEBET - (MARGINAL + 95) - 70), MARGINAL + 95);
      if (rad.belopp >= 0) {
        blad.skrivHoger(formatKronor(rad.belopp), HB_DEBET);
      } else {
        blad.skrivHoger(formatKronor(negate(rad.belopp)), HB_KREDIT);
      }
      blad.skrivHoger(formatKronor(rad.saldo), HB_SALDO);
      blad.nastaRad();
    }

    blad.plats(2);
    blad.skriv('Utgående balans', MARGINAL + 95, { fet: true });
    blad.skrivHoger(formatKronor(utdrag.utgaende), HB_SALDO, { fet: true });
    blad.nastaRad(2);
  }

  return blad.spara();
}
