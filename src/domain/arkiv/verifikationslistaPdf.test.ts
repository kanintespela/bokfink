import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import { uuidv7 } from '../id/uuidv7';
import { kontonummer, skapaKonto, type Konto, type Kontonummer } from '../konto/konto';
import type { Rakenskapsar } from '../rakenskapsar/rakenskapsar';
import { datum } from '../tid/datum';
import { verifikatserie } from '../verifikat/serie';
import type { BokfortVerifikat } from '../verifikat/verifikat';
import { skrivVerifikationslistaPdf } from './verifikationslistaPdf';

/*
 * Content-stream compression makes the produced bytes unreadable as plain
 * text, so these tests check what pdf-lib itself can verify structurally -
 * a valid header, a document that reloads, and the right number of pages.
 * The actual rendered text - Swedish characters and all - was checked by
 * hand against Poppler's pdftotext while this was written; see the commit.
 */

let klockslag = 1_788_554_000_000;
const nyttId = () => uuidv7((klockslag += 1), new Uint8Array(10).fill(7));

const KONTO_4010 = skapaKonto({ nummer: '4010', namn: 'Inköp av foder' });
const KONTO_2013 = skapaKonto({ nummer: '2013', namn: 'Egna pengar' });
const KONTON: ReadonlyMap<Kontonummer, Konto> = new Map([
  [KONTO_4010.nummer, KONTO_4010],
  [KONTO_2013.nummer, KONTO_2013],
]);

const RAKENSKAPSAR: Rakenskapsar = {
  id: nyttId(),
  start: datum('2026-01-01'),
  slut: datum('2026-12-31'),
  avslutat: false,
  ingaendeBalanser: [],
};

function verifikat(nummer: number, datumtext: string): BokfortVerifikat {
  return {
    status: 'bokfort',
    id: nyttId(),
    serie: verifikatserie('A'),
    nummer,
    datum: datum(datumtext),
    bokfortDatum: datum(datumtext),
    beskrivning: 'Inköp av kraftfoder',
    konteringar: [
      { konto: kontonummer('4010'), belopp: oreFromKronor('416.25') },
      { konto: kontonummer('2013'), belopp: oreFromKronor('-416.25') },
    ],
    kalla: 'manuell',
  };
}

describe('skrivVerifikationslistaPdf', () => {
  it('writes a document pdf-lib itself can load back', async () => {
    const pdf = await skrivVerifikationslistaPdf({
      foretagsnamn: 'Testfirman',
      rakenskapsar: RAKENSKAPSAR,
      verifikat: [verifikat(1, '2026-01-09')],
      konton: KONTON,
      skapad: datum('2026-09-08'),
    });

    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');

    const inlast = await PDFDocument.load(pdf);
    expect(inlast.getPageCount()).toBe(1);
  });

  it('writes a valid, single-page document for an empty year', async () => {
    const pdf = await skrivVerifikationslistaPdf({
      foretagsnamn: 'Testfirman',
      rakenskapsar: RAKENSKAPSAR,
      verifikat: [],
      konton: KONTON,
      skapad: datum('2026-09-08'),
    });

    const inlast = await PDFDocument.load(pdf);
    expect(inlast.getPageCount()).toBe(1);
  });

  /*
   * A verifikat is never split across a page break, so a long year has to
   * spill onto further pages rather than overflow the first one.
   */
  it('adds pages once a year has too many verifikat for one', async () => {
    const manga = Array.from({ length: 80 }, (_, i) => verifikat(i + 1, '2026-01-09'));

    const pdf = await skrivVerifikationslistaPdf({
      foretagsnamn: 'Testfirman',
      rakenskapsar: RAKENSKAPSAR,
      verifikat: manga,
      konton: KONTON,
      skapad: datum('2026-09-08'),
    });

    const inlast = await PDFDocument.load(pdf);
    expect(inlast.getPageCount()).toBeGreaterThan(1);
  });

  it('does not fail on an account the account plan no longer has', async () => {
    const pdf = await skrivVerifikationslistaPdf({
      foretagsnamn: 'Testfirman',
      rakenskapsar: RAKENSKAPSAR,
      verifikat: [verifikat(1, '2026-01-09')],
      konton: new Map(),
      skapad: datum('2026-09-08'),
    });

    const inlast = await PDFDocument.load(pdf);
    expect(inlast.getPageCount()).toBe(1);
  });
});
