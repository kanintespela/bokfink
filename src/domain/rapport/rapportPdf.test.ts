import { inflateSync } from 'node:zlib';

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import { kontonummer, skapaKonto, type Konto, type Kontonummer } from '../konto/konto';
import { datum } from '../tid/datum';
import { verifikatserie } from '../verifikat/serie';
import { bokfor, skapaUtkast, type BokfortVerifikat } from '../verifikat/verifikat';
import { beraknaBalansrakning } from './balansrakning';
import { skrivBalansPdf, skrivHuvudbokPdf, skrivResultatPdf } from './rapportPdf';
import { beraknaResultatrakning } from './resultatrakning';
import { beraknaSaldon } from './saldon';

const kr = (text: string) => oreFromKronor(text);

const KONTON: ReadonlyMap<Kontonummer, Konto> = new Map(
  [
    ['1930', 'Företagskonto', 'tillgang'],
    ['2013', 'Egna insättningar och uttag', 'egetKapital'],
    ['2640', 'Ingående moms', 'skuld'],
    ['2611', 'Utgående moms 25 %', 'skuld'],
    ['3010', 'Försäljning', 'intakt'],
    ['4010', 'Inköp av material och varor', 'kostnad'],
  ].map(([nummer, namn, typ]) => [
    kontonummer(nummer!),
    skapaKonto({ nummer: nummer!, namn: namn!, typ: typ as Konto['typ'] }),
  ]),
);

let raknare = 0;

function verifikat(
  datumtext: string,
  beskrivning: string,
  rader: readonly (readonly [string, string])[],
): BokfortVerifikat {
  raknare += 1;
  return bokfor(
    skapaUtkast({
      id: `019b76da-a800-7000-8000-${String(raknare).padStart(12, '0')}` as Uuid,
      datum: datum(datumtext),
      beskrivning,
      konteringar: rader.map(([konto, belopp]) => ({
        konto: kontonummer(konto),
        belopp: kr(belopp),
      })),
    }),
    {
      serie: verifikatserie('A'),
      nummer: raknare,
      bokfortDatum: datum(datumtext),
      kalla: 'manuell',
    },
  );
}

/*
 * Opening: 10 000 in the bank against 10 000 of own capital.
 *   feb  sale of 12 500 including 2 500 VAT       bank +12 500
 *   mar  purchase of 5 000 plus 1 250 VAT         bank  -6 250
 * Bank: 10 000 + 12 500 - 6 250 = 16 250. Result: 10 000 - 5 000 = 5 000.
 */
const INGAENDE = [
  { konto: kontonummer('1930'), belopp: kr('10000.00') },
  { konto: kontonummer('2013'), belopp: kr('-10000.00') },
];
const HANDELSER = [
  verifikat('2026-02-13', 'Försäljning av höstens skörd', [
    ['1930', '12500.00'],
    ['3010', '-10000.00'],
    ['2611', '-2500.00'],
  ]),
  verifikat('2026-03-05', 'Inköp av foder 🚜', [
    ['4010', '5000.00'],
    ['2640', '1250.00'],
    ['1930', '-6250.00'],
  ]),
];
const SALDON = beraknaSaldon(INGAENDE, HANDELSER);
const PERIOD = { fran: datum('2026-01-01'), till: datum('2026-12-31') };
const SKAPAD = datum('2026-11-20');

/**
 * The page's text, in drawing order.
 *
 * pdf-lib compresses each content stream and writes text as hex in the
 * font's WinAnsi encoding, so the streams are inflated and every `<hex> Tj`
 * decoded - the same approach as the key-figures PDF's test.
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
      // This Node reads bytes 0x80-0x9F as Latin-1 control characters rather
      // than as Windows-1252's dashes, so the two the reports draw are put back.
      delar.push(
        windows1252.decode(byte).replaceAll('\u0096', '–').replaceAll('\u0097', '—'),
      );
    }
  }
  return delar.join('\n');
}

describe('skrivResultatPdf', () => {
  const rapport = beraknaResultatrakning(SALDON, KONTON);

  it('is a titled A4 document that says whose books and which period', async () => {
    const pdf = await skrivResultatPdf({
      foretagsnamn: 'Bygdegården',
      period: PERIOD,
      rapport,
      skapad: SKAPAD,
    });
    const dokument = await PDFDocument.load(pdf);
    expect(dokument.getTitle()).toBe('Resultaträkning – Bygdegården');
    expect(dokument.getPageCount()).toBe(1);

    const innehall = await text(pdf);
    expect(innehall).toContain('Bygdegården');
    expect(innehall).toContain('Period 2026-01-01 – 2026-12-31');
    expect(innehall).toContain('Sida 1 av 1');
  });

  it('prints every account with its amount and the result at the end', async () => {
    const innehall = await text(
      await skrivResultatPdf({
        foretagsnamn: 'Bygdegården',
        period: PERIOD,
        rapport,
        skapad: SKAPAD,
      }),
    );
    expect(innehall).toContain('3010');
    expect(innehall).toContain('Försäljning');
    // formatKronor groups thousands with a no-break space; costs are negative.
    expect(innehall).toContain('10 000,00');
    expect(innehall).toContain('-5 000,00');
    expect(innehall).toContain('Periodens resultat');
    expect(innehall).toContain('5 000,00');
  });

  it('adds a column for the comparison period when there is one', async () => {
    const innehall = await text(
      await skrivResultatPdf({
        foretagsnamn: 'Bygdegården',
        period: PERIOD,
        rapport,
        jamforelse: { namn: '2025', rapport },
        skapad: SKAPAD,
      }),
    );
    expect(innehall).toContain('Jämförs med 2025');
    // Each amount now appears twice: once per column.
    expect(innehall.split('10 000,00').length - 1).toBeGreaterThanOrEqual(2);
  });
});

describe('skrivBalansPdf', () => {
  const rapport = beraknaBalansrakning(SALDON, KONTON);

  it('prints both sides and says nothing about a difference when it adds up', async () => {
    const pdf = await skrivBalansPdf({
      foretagsnamn: 'Bygdegården',
      period: PERIOD,
      rapport,
      skapad: SKAPAD,
    });
    const dokument = await PDFDocument.load(pdf);
    expect(dokument.getTitle()).toBe('Balansräkning – Bygdegården');

    const innehall = await text(pdf);
    expect(innehall).toContain('Summa tillgångar');
    expect(innehall).toContain('16 250,00');
    expect(innehall).toContain('Summa eget kapital och skulder');
    expect(innehall).not.toContain('går inte ihop');
  });

  it('says so on the page when the two sides differ', async () => {
    const innehall = await text(
      await skrivBalansPdf({
        foretagsnamn: 'Bygdegården',
        period: PERIOD,
        rapport: { ...rapport, differens: kr('100.00') },
        skapad: SKAPAD,
      }),
    );
    expect(innehall).toContain('Balansräkningen går inte ihop');
  });
});

describe('skrivHuvudbokPdf', () => {
  it('prints each account with opening balance, movements and closing balance', async () => {
    const pdf = await skrivHuvudbokPdf({
      foretagsnamn: 'Bygdegården',
      period: PERIOD,
      saldon: SALDON,
      verifikat: HANDELSER,
      konton: KONTON,
      skapad: SKAPAD,
    });
    const dokument = await PDFDocument.load(pdf);
    expect(dokument.getTitle()).toBe('Huvudbok – Bygdegården');

    const innehall = await text(pdf);
    expect(innehall).toContain('1930 Företagskonto');
    expect(innehall).toContain('Ingående balans');
    expect(innehall).toContain('A1');
    expect(innehall).toContain('2026-02-13');
    expect(innehall).toContain('Försäljning av höstens skörd');
    expect(innehall).toContain('Utgående balans');
    expect(innehall).toContain('16 250,00');
    // A letter the font has not got becomes a question mark, not a failure.
    expect(innehall).toContain('Inköp av foder ?');
  });

  it('runs onto more pages when the ledger is long, with a page count on each', async () => {
    const manga = Array.from({ length: 120 }, (_, i) =>
      verifikat('2026-05-01', `Rad ${i + 1}`, [
        ['1930', '1.00'],
        ['3010', '-1.00'],
      ]),
    );
    const pdf = await skrivHuvudbokPdf({
      foretagsnamn: 'Bygdegården',
      period: PERIOD,
      saldon: beraknaSaldon(INGAENDE, manga),
      verifikat: manga,
      konton: KONTON,
      skapad: SKAPAD,
    });
    const dokument = await PDFDocument.load(pdf);
    const sidor = dokument.getPageCount();
    expect(sidor).toBeGreaterThan(1);

    const innehall = await text(pdf);
    expect(innehall).toContain(`Sida 1 av ${sidor}`);
    expect(innehall).toContain(`Sida ${sidor} av ${sidor}`);
    // The column headings come back at the top of every page.
    expect(innehall.split('Debet').length - 1).toBe(sidor);
  });

  it('says so instead of printing an empty page when nothing has moved', async () => {
    const innehall = await text(
      await skrivHuvudbokPdf({
        foretagsnamn: 'Bygdegården',
        period: PERIOD,
        saldon: new Map(),
        verifikat: [],
        konton: KONTON,
        skapad: SKAPAD,
      }),
    );
    expect(innehall).toContain('Inget konto har rört sig');
  });
});
