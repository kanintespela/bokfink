import { inflateSync } from 'node:zlib';

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import { kontonummer } from '../konto/konto';
import { skapaRakenskapsar } from '../rakenskapsar/rakenskapsar';
import { datum } from '../tid/datum';
import type { Nyckeltalsoversikt } from './oversikt';
import { skrivOversiktPdf } from './oversiktPdf';

const kr = (text: string) => oreFromKronor(text);

const AR = skapaRakenskapsar({
  id: '019b76da-a800-7000-8000-000000002026' as Uuid,
  start: datum('2026-01-01'),
  slut: datum('2026-12-31'),
  ingaendeBalanser: [],
});

const OVERSIKT: Nyckeltalsoversikt = {
  ar: AR,
  till: datum('2026-11-17'),
  iAr: {
    intakter: kr('10000.00'),
    kostnader: kr('12500.00'),
    finansiellaPoster: kr('0.00'),
    resultat: kr('-2500.00'),
    likvida: kr('16290.00'),
  },
  moms: kr('-250.00'),
  ifjol: {
    ar: { ...AR, start: datum('2025-01-01'), slut: datum('2025-12-31') },
    till: datum('2025-11-17'),
    tal: {
      intakter: kr('1000.00'),
      kostnader: kr('0.00'),
      finansiellaPoster: kr('0.00'),
      resultat: kr('1000.00'),
      likvida: kr('1250.00'),
    },
  },
  resultatPerManad: [
    { manad: '2026-10', belopp: kr('10000.00') },
    { manad: '2026-11', belopp: kr('-12500.00') },
  ],
  likviditetPerManad: [
    { manad: '2026-10', belopp: kr('28790.00') },
    { manad: '2026-11', belopp: kr('16290.00') },
  ],
  kostnader: [
    { konto: kontonummer('5611'), namn: 'Drivmedel 🚜', belopp: kr('12500.00') },
  ],
};

/**
 * The page's text, in drawing order.
 *
 * pdf-lib compresses each content stream and writes text as hex in the
 * font's WinAnsi encoding, so the streams are inflated and every `<hex> Tj`
 * decoded. Not a PDF reader, but enough to see what the page says - pdf.js
 * would be one, and needs a newer Node than the server this is run on.
 */
async function text(pdf: Uint8Array): Promise<string> {
  const dokument = await PDFDocument.load(pdf);
  const delar: string[] = [];
  const windows1252 = new TextDecoder('windows-1252');
  for (const [, objekt] of dokument.context.enumerateIndirectObjects()) {
    if (!('getContents' in objekt) || typeof objekt.getContents !== 'function') {
      continue;
    }
    const innehall = new TextDecoder('latin1').decode(
      inflateSync(objekt.getContents() as Uint8Array),
    );
    for (const traff of innehall.matchAll(/<([0-9A-Fa-f]*)> Tj/g)) {
      const hex = traff[1] ?? '';
      const byte = new Uint8Array(hex.length / 2);
      for (let i = 0; i < byte.length; i += 1) {
        byte[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      delar.push(windows1252.decode(byte));
    }
  }
  return delar.join('\n');
}

describe('skrivOversiktPdf', () => {
  it('writes one A4 page that pdf-lib can load back, titled for the book', async () => {
    const pdf = await skrivOversiktPdf({
      namn: 'Bygdegården',
      oversikt: OVERSIKT,
      visaMoms: true,
      skapad: datum('2026-11-17'),
    });

    const dokument = await PDFDocument.load(pdf);
    expect(dokument.getPageCount()).toBe(1);
    expect(dokument.getTitle()).toBe('Nyckeltal 2026 – Bygdegården');
  });

  it("says whose books, which stretch of the year, and last year's figures", async () => {
    const innehall = await text(
      await skrivOversiktPdf({
        namn: 'Bygdegården',
        oversikt: OVERSIKT,
        visaMoms: true,
        skapad: datum('2026-11-17'),
      }),
    );

    expect(innehall).toContain('Bygdegården');
    expect(innehall).toContain('till och med 2026-11-17');
    expect(innehall).toContain('Samma period året före');
    // formatKronor groups thousands with a no-break space.
    expect(innehall).toContain('-2\u00a0500,00');
    expect(innehall).toContain('1\u00a0000,00');
    // Moms coming back is written as the amount it is, with the direction in words.
    expect(innehall).toContain('Moms att få tillbaka');
    expect(innehall).toContain('November hittills');
    expect(innehall).toContain('Den 2026-11-17');
    // A letter the font has not got becomes a question mark, not a failure.
    expect(innehall).toContain('5611 Drivmedel ?');
  });

  it('leaves out moms for a book that has none, and last year when there is none', async () => {
    const utanFjol: Nyckeltalsoversikt = { ...OVERSIKT };
    delete (utanFjol as { ifjol?: unknown }).ifjol;
    const innehall = await text(
      await skrivOversiktPdf({
        namn: 'Bygdegården',
        oversikt: utanFjol,
        visaMoms: false,
        skapad: datum('2026-11-17'),
      }),
    );

    expect(innehall).not.toContain('Moms');
    expect(innehall).not.toContain('året före');
  });
});
