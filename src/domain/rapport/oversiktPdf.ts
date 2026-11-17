import type { PDFPage, RGB } from 'pdf-lib';

import { add, formatKronor, negate, ZERO, type Ore } from '../belopp/ore';
import { sistaIManaden, type Datum } from '../tid/datum';
import type { Manadsvarde } from './nyckeltal';
import type { Nyckeltalsoversikt, Oversiktstal } from './oversikt';

/**
 * The Nyckeltal view as one A4 page, to print or send on.
 *
 * Someone who is not in the app - a partner, the association's board, a bank
 * - should be able to read how the year is going from a single sheet. So the
 * page says whose books and which stretch of which year it is about, puts the
 * figures before the pictures as the view does, and writes every picture's
 * scale and months out in text: a chart that cannot be read without the app
 * beside it has no business being exported.
 *
 * Drawn with pdf-lib's own shapes rather than a picture of the screen, so it
 * stays sharp at any size and its text can be searched and copied. Helvetica's
 * WinAnsi encoding covers å, ä and ö, so no font is embedded.
 */
export interface Oversiktsuppgifter {
  /** The book's name, which is what the reader knows the books by. */
  readonly namn: string;
  readonly oversikt: Nyckeltalsoversikt;
  /** False for a book with no moms, which then has no moms figure. */
  readonly visaMoms: boolean;
  /** When the page says it was made. Domain has no clock; this is it. */
  readonly skapad: Datum;
}

const SIDBREDD = 595.28; // A4, in points.
const SIDHOJD = 841.89;
const MARGINAL = 50;
const INNERBREDD = SIDBREDD - 2 * MARGINAL;

const TEXT = 9;
const LITEN = 7.5;

const SVART = [0.13, 0.13, 0.13] as const;
const GRA = [0.45, 0.45, 0.45] as const;
const LJUSGRA = [0.85, 0.85, 0.85] as const;
const GRON = [0.18, 0.49, 0.33] as const;
const ROD = [0.75, 0.24, 0.2] as const;

const MANADSNAMN = [
  'januari',
  'februari',
  'mars',
  'april',
  'maj',
  'juni',
  'juli',
  'augusti',
  'september',
  'oktober',
  'november',
  'december',
];

function versal(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export async function skrivOversiktPdf(
  uppgifter: Oversiktsuppgifter,
): Promise<Uint8Array> {
  // Imported here, not at the top: a few hundred kilobytes nobody should pay
  // for by opening the app, for a page made now and then.
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

  const { oversikt } = uppgifter;
  const dokument = await PDFDocument.create();
  const artal = arstext(oversikt.ar.start, oversikt.ar.slut);
  dokument.setTitle(`Nyckeltal ${artal} – ${uppgifter.namn}`);
  dokument.setCreator('Bokfink');
  const font = await dokument.embedFont(StandardFonts.Helvetica);
  const fet = await dokument.embedFont(StandardFonts.HelveticaBold);
  const sida = dokument.addPage([SIDBREDD, SIDHOJD]);
  const farg = (varden: readonly [number, number, number]): RGB =>
    rgb(varden[0], varden[1], varden[2]);

  /*
   * Text the built-in font has no letter for is written as a question mark.
   * pdf-lib refuses it outright otherwise, and a book or account named with
   * an emoji would stop the page.
   */
  const kanSkrivas = new Set(font.getCharacterSet());
  const rensa = (text: string): string =>
    [...text]
      .map((tecken) => (kanSkrivas.has(tecken.codePointAt(0)!) ? tecken : '?'))
      .join('');

  const ritare: Ritare = {
    sida,
    farg,
    text(
      text,
      x,
      y,
      { storlek = TEXT, fetstil = false, fargen = SVART, hoger = false } = {},
    ) {
      const anvand = fetstil ? fet : font;
      const ren = rensa(text);
      const bredd = anvand.widthOfTextAtSize(ren, storlek);
      sida.drawText(ren, {
        x: hoger ? x - bredd : x,
        y,
        size: storlek,
        font: anvand,
        color: farg(fargen),
      });
    },
    bredd: (text, storlek = TEXT, fetstil = false) =>
      (fetstil ? fet : font).widthOfTextAtSize(rensa(text), storlek),
  };

  let y = SIDHOJD - MARGINAL - 12;
  ritare.text(`Nyckeltal ${artal}`, MARGINAL, y, { storlek: 20, fetstil: true });
  y -= 18;
  ritare.text(uppgifter.namn, MARGINAL, y, { storlek: 12 });
  y -= 16;
  ritare.text(periodtext(oversikt), MARGINAL, y, { fargen: GRA });
  y -= 12;
  ritare.text(`Skapad ${uppgifter.skapad} i Bokfink`, MARGINAL, y, { fargen: GRA });

  y -= 30;
  y = tabell(ritare, oversikt, uppgifter.visaMoms, y);

  y -= 26;
  y = manadsdiagram(ritare, {
    rubrik: 'Resultat per månad',
    varden: oversikt.resultatPerManad,
    ar: oversikt.ar.start,
    till: oversikt.till,
    y,
    staplar: true,
  });

  y -= 22;
  y = manadsdiagram(ritare, {
    rubrik: 'Pengar i kassa och bank vid varje månadsslut',
    varden: oversikt.likviditetPerManad,
    ar: oversikt.ar.start,
    till: oversikt.till,
    y,
    staplar: false,
  });

  y -= 22;
  kostnader(ritare, oversikt, y);

  return dokument.save();
}

interface Textval {
  readonly storlek?: number;
  readonly fetstil?: boolean;
  readonly fargen?: readonly [number, number, number];
  /** x is the right edge, for figures in a column. */
  readonly hoger?: boolean;
}

interface Ritare {
  readonly sida: PDFPage;
  readonly farg: (varden: readonly [number, number, number]) => RGB;
  text(text: string, x: number, y: number, val?: Textval): void;
  bredd(text: string, storlek?: number, fetstil?: boolean): number;
}

/** 2026, or 2025/26 for a fiscal year that does not follow the calendar. */
function arstext(start: Datum, slut: Datum): string {
  return start.slice(0, 4) === slut.slice(0, 4)
    ? start.slice(0, 4)
    : `${start.slice(0, 4)}/${slut.slice(2, 4)}`;
}

function periodtext(oversikt: Nyckeltalsoversikt): string {
  const ar = `Räkenskapsår ${oversikt.ar.start} – ${oversikt.ar.slut}`;
  return oversikt.till === oversikt.ar.slut
    ? `${ar}, hela året`
    : `${ar}, till och med ${oversikt.till}`;
}

/**
 * The figures, with last year's beside them.
 *
 * Last year's column is the same stretch of that year, so a year still
 * running is not set against one that is over. Moms is a position at one
 * moment and has nothing to compare with.
 */
function tabell(
  ritare: Ritare,
  oversikt: Nyckeltalsoversikt,
  visaMoms: boolean,
  start: number,
): number {
  const iAr = MARGINAL + INNERBREDD - 130;
  const ifjol = MARGINAL + INNERBREDD;
  let y = start;

  ritare.text('I år', iAr, y, { fetstil: true, hoger: true });
  if (oversikt.ifjol !== undefined) {
    ritare.text(
      oversikt.till === oversikt.ar.slut ? 'Året före' : 'Samma period året före',
      ifjol,
      y,
      { fetstil: true, hoger: true },
    );
  }
  y -= 6;
  linje(ritare, y);
  y -= 14;

  const fjol = oversikt.ifjol?.tal;
  const rad = (
    etikett: string,
    las: (tal: Oversiktstal) => Ore,
    { fetstil = false, tecken = false }: { fetstil?: boolean; tecken?: boolean } = {},
  ) => {
    ritare.text(etikett, MARGINAL, y, { fetstil });
    const varde = las(oversikt.iAr);
    ritare.text(formatKronor(varde), iAr, y, {
      fetstil,
      hoger: true,
      fargen: tecken && varde < 0 ? ROD : SVART,
    });
    if (fjol !== undefined) {
      ritare.text(formatKronor(las(fjol)), ifjol, y, { hoger: true, fargen: GRA });
    }
    y -= 16;
  };

  rad('Intäkter', (tal) => tal.intakter);
  rad('Kostnader', (tal) => tal.kostnader);
  if (oversikt.iAr.finansiellaPoster !== 0 || (fjol?.finansiellaPoster ?? 0) !== 0) {
    rad('Finansiella poster', (tal) => tal.finansiellaPoster);
  }
  y -= 4;
  linje(ritare, y + 13);
  rad('Resultat', (tal) => tal.resultat, { fetstil: true, tecken: true });
  y -= 4;
  rad('Pengar i kassa och bank', (tal) => tal.likvida, { tecken: true });

  if (visaMoms) {
    const attFa = oversikt.moms < 0;
    ritare.text(attFa ? 'Moms att få tillbaka' : 'Moms att betala', MARGINAL, y);
    ritare.text(formatKronor(attFa ? negate(oversikt.moms) : oversikt.moms), iAr, y, {
      hoger: true,
    });
    y -= 16;
  }

  return y;
}

function linje(ritare: Ritare, y: number): void {
  ritare.sida.drawLine({
    start: { x: MARGINAL, y },
    end: { x: MARGINAL + INNERBREDD, y },
    thickness: 0.5,
    color: ritare.farg(LJUSGRA),
  });
}

const PLOTHOJD = 110;

/**
 * A month chart as on the screen: bars for a result, which happens in a
 * month, and a line for money in the bank, which is carried from one month
 * to the next. Zero and the highest and lowest figures are written on their
 * lines, and the months that have not begun are left blank.
 */
function manadsdiagram(
  ritare: Ritare,
  {
    rubrik,
    varden,
    ar,
    till,
    y: start,
    staplar,
  }: {
    readonly rubrik: string;
    readonly varden: readonly Manadsvarde[];
    readonly ar: Datum;
    readonly till: Datum;
    readonly y: number;
    readonly staplar: boolean;
  },
): number {
  ritare.text(rubrik, MARGINAL, start, { storlek: 11, fetstil: true });
  const topp = start - 14;
  const botten = topp - PLOTHOJD;

  // Twelve slots from the year's first month, whichever month that is.
  const forsta = Number(ar.slice(5, 7)) - 1;
  const plats = INNERBREDD / 12;
  const mitt = (manad: string) => {
    const index = (Number(manad.slice(5, 7)) - 1 - forsta + 12) % 12;
    return MARGINAL + index * plats + plats / 2;
  };

  const belopp = varden.map((varde) => varde.belopp);
  const hogst = Math.max(0, ...belopp);
  const lagst = Math.min(0, ...belopp);
  const spann = Math.max(1, hogst - lagst);
  const y = (varde: number) => botten + ((varde - lagst) / spann) * PLOTHOJD;

  const stodlinjer = [
    { varde: 0, noll: true },
    ...(hogst > 0 ? [{ varde: hogst, noll: false }] : []),
    ...(lagst < 0 ? [{ varde: lagst, noll: false }] : []),
  ].filter((linjen) => linjen.noll || Math.abs(y(linjen.varde) - y(0)) >= 12);
  for (const linjen of stodlinjer) {
    ritare.sida.drawLine({
      start: { x: MARGINAL, y: y(linjen.varde) },
      end: { x: MARGINAL + INNERBREDD, y: y(linjen.varde) },
      thickness: linjen.noll ? 0.8 : 0.4,
      color: ritare.farg(linjen.noll ? GRA : LJUSGRA),
      ...(linjen.noll ? {} : { dashArray: [2, 2] }),
    });
    ritare.text(
      linjen.noll ? '0' : formatKronor(linjen.varde as Ore),
      MARGINAL,
      y(linjen.varde) + 2,
      {
        storlek: LITEN,
        fargen: GRA,
      },
    );
  }

  if (staplar) {
    for (const varde of varden) {
      const fran = Math.min(y(varde.belopp), y(0));
      const hojd = Math.abs(y(varde.belopp) - y(0));
      if (hojd === 0) {
        continue;
      }
      ritare.sida.drawRectangle({
        x: mitt(varde.manad) - plats * 0.32,
        y: fran,
        width: plats * 0.64,
        height: Math.max(0.8, hojd),
        color: ritare.farg(varde.belopp < 0 ? ROD : GRON),
      });
    }
  } else {
    for (const [index, varde] of varden.entries()) {
      const nasta = varden[index + 1];
      if (nasta !== undefined) {
        ritare.sida.drawLine({
          start: { x: mitt(varde.manad), y: y(varde.belopp) },
          end: { x: mitt(nasta.manad), y: y(nasta.belopp) },
          thickness: 1.6,
          color: ritare.farg(GRON),
        });
      }
      ritare.sida.drawCircle({
        x: mitt(varde.manad),
        y: y(varde.belopp),
        size: 2.4,
        color: ritare.farg(varde.belopp < 0 ? ROD : GRON),
      });
    }
  }

  // The month letters, and the last figure written out beside its month.
  for (let index = 0; index < 12; index += 1) {
    const bokstav = versal(MANADSNAMN[(forsta + index) % 12] ?? '').charAt(0);
    const x = MARGINAL + index * plats + plats / 2;
    ritare.text(bokstav, x - ritare.bredd(bokstav, LITEN) / 2, botten - 11, {
      storlek: LITEN,
      fargen: GRA,
    });
  }
  const sista = varden[varden.length - 1];
  if (sista !== undefined) {
    const pagaende = sista.manad === till.slice(0, 7) && till !== sistaIManaden(till);
    const manad = MANADSNAMN[Number(sista.manad.slice(5, 7)) - 1] ?? sista.manad;
    const nar = staplar
      ? `${versal(manad)}${pagaende ? ' hittills' : ''}`
      : pagaende
        ? `Den ${till}`
        : `I slutet av ${manad}`;
    const text = `${nar}: ${formatKronor(sista.belopp)}`;
    ritare.text(text, MARGINAL + INNERBREDD, start, { hoger: true, fargen: GRA });
  }

  return botten - 14;
}

/**
 * Where the money went, as named bars with their figures: the same accounts
 * as on the screen, with the rest gathered into one line so the bars add up
 * to all of it.
 */
function kostnader(ritare: Ritare, oversikt: Nyckeltalsoversikt, start: number): void {
  ritare.text('Vad pengarna gick till', MARGINAL, start, { storlek: 11, fetstil: true });
  let y = start - 18;
  if (oversikt.kostnader.length === 0) {
    ritare.text('Inga kostnader bokförda under perioden.', MARGINAL, y, { fargen: GRA });
    return;
  }

  const storsta = Math.max(1, ...oversikt.kostnader.map((post) => post.belopp));
  const summa = oversikt.kostnader.reduce((total, post) => add(total, post.belopp), ZERO);
  const namnbredd = 170;
  const beloppsbredd = 80;
  const spar = INNERBREDD - namnbredd - beloppsbredd - 10;

  for (const post of oversikt.kostnader) {
    const namn = post.konto === '' ? post.namn : `${post.konto} ${post.namn}`;
    ritare.text(kortad(ritare, namn, namnbredd - 8), MARGINAL, y);
    ritare.sida.drawRectangle({
      x: MARGINAL + namnbredd,
      y: y - 1,
      width: spar,
      height: 8,
      color: ritare.farg([0.94, 0.94, 0.94]),
    });
    ritare.sida.drawRectangle({
      x: MARGINAL + namnbredd,
      y: y - 1,
      width: Math.max(0.8, (post.belopp / storsta) * spar),
      height: 8,
      color: ritare.farg(GRON),
    });
    ritare.text(formatKronor(post.belopp), MARGINAL + INNERBREDD, y, { hoger: true });
    y -= 16;
  }
  linje(ritare, y + 10);
  ritare.text('Summa kostnader', MARGINAL, y - 2, { fetstil: true });
  ritare.text(formatKronor(summa), MARGINAL + INNERBREDD, y - 2, {
    fetstil: true,
    hoger: true,
  });
}

/** A name cut with an ellipsis rather than run into its bar. */
function kortad(ritare: Ritare, text: string, bredd: number): string {
  if (ritare.bredd(text) <= bredd) {
    return text;
  }
  let kortare = text;
  while (kortare.length > 1 && ritare.bredd(`${kortare}…`) > bredd) {
    kortare = kortare.slice(0, -1);
  }
  return `${kortare.trimEnd()}…`;
}
