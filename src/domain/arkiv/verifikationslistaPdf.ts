import type { PDFFont } from 'pdf-lib';

import { formatKronor } from '../belopp/ore';
import type { Kontonummer, Konto } from '../konto/konto';
import type { Rakenskapsar } from '../rakenskapsar/rakenskapsar';
import type { Datum } from '../tid/datum';
import { beteckning, type BokfortVerifikat } from '../verifikat/verifikat';

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

  function rad(
    text: string,
    installningar: { readonly font?: PDFFont; readonly storlek?: number } = {},
  ): void {
    sida.drawText(text, {
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

  for (const verifikat of sorterade) {
    // The heading plus every kontering line, so a verifikat is never split
    // across a page break.
    nyttUtrymme(RADHOJD * (1 + verifikat.konteringar.length) + 6);

    rad(`${beteckning(verifikat)}   ${verifikat.datum}   ${verifikat.beskrivning}`, {
      font: fetFont,
    });
    for (const kontering of verifikat.konteringar) {
      const konto = uppgifter.konton.get(kontering.konto);
      const namn = konto?.namn ?? '';
      sida.drawText(`${kontering.konto}  ${namn}`, {
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
