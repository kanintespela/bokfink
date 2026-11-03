import type { PDFFont } from 'pdf-lib';

import { formatKronor } from '../belopp/ore';
import type { Kontonummer, Konto } from '../konto/konto';
import type { Rakenskapsar } from '../rakenskapsar/rakenskapsar';
import type { Datum } from '../tid/datum';
import { beteckning, type BokfortVerifikat, type Rattelse } from '../verifikat/verifikat';

/**
 * The verifikationslista as a PDF, for the seven-year archive package.
 *
 * Bokföringslagen 7 kap. asks that räkenskapsinformation stay presentable in
 * ordinary readable form for the whole archiving period. A JSON export or a
 * SIE file both fail that test on their own - either needs software to make
 * sense of - so the archive carries this alongside them: every booked
 * verifikat, printed the way a ledger has always been printed, openable by
 * anyone with a PDF reader and nothing else.
 *
 * Helvetica's built-in WinAnsi encoding already covers å, ä and ö (they sit
 * in the Latin-1 range), so no font needs to be embedded for Swedish text to
 * render correctly.
 */
export interface VerifikationslistaUppgifter {
  readonly foretagsnamn: string;
  readonly rakenskapsar: Rakenskapsar;
  readonly verifikat: readonly BokfortVerifikat[];
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  /** When the PDF says it was produced. Domain has no clock; this is it. */
  readonly skapad: Datum;
}

const SIDBREDD = 595.28; // A4, in points.
const SIDHOJD = 841.89;
const MARGINAL = 50;
const RADHOJD = 14;
const TEXTSTORLEK = 9;
const RUBRIKSTORLEK = 16;

/**
 * A correction in words, for the line under the verifikat it concerns.
 *
 * Bokföringslagen 5 kap. 5 och 8 §§: a correction has to be possible to find
 * out about when the books are examined. The SIE file cannot carry it, so
 * this list - the part of the archive anyone can read - does.
 */
export function rattelsetext(rattelse: Rattelse): string {
  const nar = rattelse.nar.slice(0, 10);
  switch (rattelse.falt) {
    case 'beskrivning':
      return `Beskrivning rättad ${nar}: "${rattelse.fran}" blev "${rattelse.till}"`;
    case 'datum':
      return `Datum rättat ${nar}: ${rattelse.fran} blev ${rattelse.till}`;
    case 'projekt':
      return `Projekt på rad ${(rattelse.rad ?? 0) + 1} ändrat ${nar}`;
  }
}

function efterSerieOchNummer(a: BokfortVerifikat, b: BokfortVerifikat): number {
  return a.serie === b.serie ? a.nummer - b.nummer : a.serie.localeCompare(b.serie);
}

export async function skrivVerifikationslistaPdf(
  uppgifter: VerifikationslistaUppgifter,
): Promise<Uint8Array> {
  // Imported here, not at the top: a few hundred kilobytes nobody should pay
  // for by opening the app, for a document only the archive package needs.
  const { PDFDocument, StandardFonts } = await import('pdf-lib');

  const dokument = await PDFDocument.create();
  const font = await dokument.embedFont(StandardFonts.Helvetica);
  const fetFont = await dokument.embedFont(StandardFonts.HelveticaBold);

  let sida = dokument.addPage([SIDBREDD, SIDHOJD]);
  let y = SIDHOJD - MARGINAL;

  /** Starts a fresh page when the next block would not fit on this one. */
  function nyttUtrymme(hojd: number): void {
    if (y - hojd < MARGINAL) {
      sida = dokument.addPage([SIDBREDD, SIDHOJD]);
      y = SIDHOJD - MARGINAL;
    }
  }

  /*
   * Text the built-in font has no letter for is written as a question mark.
   * pdf-lib refuses it outright otherwise, and a description with an emoji
   * in it stopped the whole archive package.
   */
  const kanSkrivas = new Set(font.getCharacterSet());
  const rensa = (text: string): string =>
    [...text]
      .map((tecken) => (kanSkrivas.has(tecken.codePointAt(0)!) ? tecken : '?'))
      .join('');

  function rad(
    text: string,
    installningar: { readonly font?: PDFFont; readonly storlek?: number } = {},
  ): void {
    sida.drawText(rensa(text), {
      x: MARGINAL,
      y,
      size: installningar.storlek ?? TEXTSTORLEK,
      font: installningar.font ?? font,
    });
    y -= RADHOJD;
  }

  rad(`Verifikationslista — ${uppgifter.foretagsnamn}`, {
    font: fetFont,
    storlek: RUBRIKSTORLEK,
  });
  y -= 6;
  rad(`Räkenskapsår ${uppgifter.rakenskapsar.start} – ${uppgifter.rakenskapsar.slut}`);
  rad(`Skapad ${uppgifter.skapad}`);
  y -= RADHOJD;

  const sorterade = [...uppgifter.verifikat].sort(efterSerieOchNummer);

  if (sorterade.length === 0) {
    rad('Inga bokförda verifikat i det här räkenskapsåret.');
  }

  const beteckningPaId = new Map(sorterade.map((v) => [v.id, beteckning(v)]));
  const annulleradAv = new Map(
    sorterade.flatMap((v) =>
      v.annullerar === undefined ? [] : [[v.annullerar, beteckning(v)] as const],
    ),
  );

  for (const verifikat of sorterade) {
    const noteringar = [
      ...(verifikat.rattelser ?? []).map(rattelsetext),
      ...(verifikat.annullerar === undefined
        ? []
        : [
            `Annullerar ${beteckningPaId.get(verifikat.annullerar) ?? 'ett verifikat från ett annat räkenskapsår'}`,
          ]),
      ...(annulleradAv.has(verifikat.id)
        ? [`Annullerad av ${annulleradAv.get(verifikat.id)}`]
        : []),
    ];

    // The heading, the notes and every kontering line, so a verifikat is
    // never split across a page break.
    nyttUtrymme(RADHOJD * (1 + noteringar.length + verifikat.konteringar.length) + 6);

    rad(`${beteckning(verifikat)}   ${verifikat.datum}   ${verifikat.beskrivning}`, {
      font: fetFont,
    });
    for (const notering of noteringar) {
      sida.drawText(rensa(notering), {
        x: MARGINAL + 16,
        y,
        size: TEXTSTORLEK,
        font,
      });
      y -= RADHOJD;
    }
    for (const kontering of verifikat.konteringar) {
      const konto = uppgifter.konton.get(kontering.konto);
      const namn = konto?.namn ?? '';
      sida.drawText(rensa(`${kontering.konto}  ${namn}`), {
        x: MARGINAL + 16,
        y,
        size: TEXTSTORLEK,
        font,
      });
      sida.drawText(formatKronor(kontering.belopp), {
        x: SIDBREDD - MARGINAL - 70,
        y,
        size: TEXTSTORLEK,
        font,
      });
      y -= RADHOJD;
    }
    y -= 4;
  }

  return dokument.save();
}
