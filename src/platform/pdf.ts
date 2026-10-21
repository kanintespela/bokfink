/**
 * Reading the text out of a PDF.
 *
 * A supplier's invoice arrives as a PDF with a real text layer, and reading
 * that layer is not the same job as reading a photograph: the characters are
 * already characters. Both invoices tested came out exactly right - amount,
 * VAT and date - where two of four photographed receipts could not be read at
 * all. Where a PDF exists, this is the way in.
 *
 * pdf.js (Apache-2.0), parsing in a worker of its own so a slow invoice does
 * not freeze the screen it is being read into. Everything it needs is served
 * from our own origin (hard rule 7); scripts/kopiera-tesseract.mjs puts it
 * there.
 *
 * Its legacy build, not the default one. The default build calls language
 * features so new that only the latest browsers have them -
 * Map.prototype.getOrInsertComputed, Math.sumPrecise, Promise.try - with no
 * fallback, and an iPhone a version behind fails on the first PDF that takes
 * one of those paths, or hangs: a missing Promise.try in the message handler
 * means an answer that never arrives. The legacy build is the same version
 * from the same package with those filled in, for about 110 kB more - and
 * only fetched once a PDF is to be read.
 */

/** Where the copied files are served from. */
const PDF_BAS = '/pdf';

/**
 * How far apart two pieces of text may sit vertically and still be one line.
 *
 * A PDF places every fragment separately, so a line is only a line by its
 * coordinates. Three points covers the wobble in a table row without joining
 * two rows of ordinary type.
 */
const RADSPRANG = 3;

/**
 * Points per character when laying the text back out.
 *
 * The extracted text is read by the same interpreter that reads OCR output,
 * which works line by line and matches columns by character position. Five
 * points is about one character of ordinary invoice type, so a totals row
 * lands roughly under its heading - which is what lets "ATT BETALA" find its
 * own figure among five in the row below.
 */
const PUNKTER_PER_TECKEN = 5;

interface Textpost {
  readonly str: string;
  readonly transform: readonly number[];
}

/** Turns pdf.js's positioned fragments back into lines of text. */
export function laggUtText(poster: readonly Textpost[]): string {
  const rader = new Map<number, { x: number; text: string }[]>();

  for (const post of poster) {
    if (post.str.trim().length === 0) {
      continue;
    }
    const y = Math.round(post.transform[5] ?? 0);
    const nyckel = [...rader.keys()].find(
      (kandidat) => Math.abs(kandidat - y) <= RADSPRANG,
    );
    const rad = rader.get(nyckel ?? y) ?? [];
    rad.push({ x: post.transform[4] ?? 0, text: post.str });
    rader.set(nyckel ?? y, rad);
  }

  return (
    [...rader.entries()]
      // A PDF's y grows upwards, so the page reads from the largest.
      .sort((a, b) => b[0] - a[0])
      .map(([, poster]) => {
        let rad = '';
        for (const post of [...poster].sort((a, b) => a.x - b.x)) {
          const kolumn = Math.round(post.x / PUNKTER_PER_TECKEN);
          if (kolumn > rad.length) {
            rad = rad.padEnd(kolumn, ' ');
          } else if (rad.length > 0 && !rad.endsWith(' ')) {
            // Two fragments that touch are one word; a space keeps them apart
            // as OCR would have.
            rad += ' ';
          }
          rad += post.text;
        }
        return rad.trimEnd();
      })
      .join('\n')
  );
}

/** Parses a PDF with pdf.js, in its worker. */
async function oppnaDokument(data: Uint8Array) {
  // Imported here: two megabytes nobody should pay for by opening the app.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDF_BAS}/pdf.worker.min.mjs`;

  return pdfjs.getDocument({
    // Copied, because pdf.js takes ownership of the buffer it is given and
    // the same bytes are still wanted for storing and showing the underlag.
    data: new Uint8Array(data),
    cMapUrl: `${PDF_BAS}/cmaps/`,
    cMapPacked: true,
  }).promise;
}

/**
 * Reads every page of a PDF as text.
 *
 * Returns nothing readable rather than throwing when the file has no text
 * layer - a scanned invoice is a picture of an invoice, and the caller says
 * so in its own words.
 */
export async function lasPdftext(data: Uint8Array): Promise<string> {
  const dokument = await oppnaDokument(data);

  try {
    const sidor: string[] = [];
    for (let nummer = 1; nummer <= dokument.numPages; nummer += 1) {
      const sida = await dokument.getPage(nummer);
      sidor.push(laggUtText(await lasSidtext(sida)));
    }
    return sidor.join('\n');
  } finally {
    await dokument.cleanup();
  }
}

/**
 * Every piece of text on a page, read off the stream pdf.js delivers it in.
 *
 * Not page.getTextContent(): that walks the same stream with `for await`, and
 * Safari's ReadableStream cannot be iterated that way. On an iPhone it failed
 * with "undefined is not a function (near '...e of t...')" before a single
 * character was read, while the same invoice read fine in Chrome. The
 * legacy build does not fill that gap - it is a missing part of the browser's
 * streams, not of the language - but a reader works wherever streams do.
 */
export async function lasSidtext(sida: {
  streamTextContent(): ReadableStream<unknown>;
}): Promise<Textpost[]> {
  const lasare = sida.streamTextContent().getReader();
  const poster: Textpost[] = [];
  try {
    for (;;) {
      const { done, value } = await lasare.read();
      if (done) {
        return poster;
      }
      poster.push(...(value as { items: Textpost[] }).items);
    }
  } finally {
    lasare.releaseLock();
  }
}

/**
 * The most pixels one canvas may hold.
 *
 * Safari on iOS refuses to draw on a canvas larger than 4096 x 4096 and
 * leaves it blank instead of failing, so a page zoomed in on a sharp screen
 * would simply vanish. Past this the page is drawn coarser, not bigger.
 */
export const MAX_PIXLAR = 4096 * 4096;

/**
 * How far to scale a page so it fills a width on screen.
 *
 * `bredd` is in CSS pixels and `tathet` is the screen's device pixels per
 * CSS pixel, so the page is drawn sharp rather than stretched - and scaled
 * back down when that would pass MAX_PIXLAR.
 */
export function ritskala(
  sida: { readonly width: number; readonly height: number },
  bredd: number,
  tathet: number,
): number {
  const skala = (bredd * tathet) / sida.width;
  const pixlar = sida.width * sida.height * skala * skala;
  return pixlar <= MAX_PIXLAR ? skala : skala * Math.sqrt(MAX_PIXLAR / pixlar);
}

/** A PDF opened for showing, one page at a time. */
export interface Pdfvisning {
  readonly antalSidor: number;
  /** Draws a page (from 1) on the canvas, filling `bredd` CSS pixels. */
  rita(
    sidnummer: number,
    canvas: HTMLCanvasElement,
    bredd: number,
    tathet: number,
  ): Promise<void>;
  /** Lets go of the parsed document and the memory it holds. */
  stang(): Promise<void>;
}

/**
 * Opens a PDF to be looked at inside the app.
 *
 * Drawn by pdf.js rather than handed to the browser: an iPhone shows only the
 * first page of a PDF in an iframe or object, and a new window opened from an
 * app on the home screen does not reliably reach the app's blob URLs.
 */
export async function oppnaPdf(data: Uint8Array): Promise<Pdfvisning> {
  const dokument = await oppnaDokument(data);
  return {
    antalSidor: dokument.numPages,
    async rita(sidnummer, canvas, bredd, tathet) {
      const sida = await dokument.getPage(sidnummer);
      const vy = sida.getViewport({
        scale: ritskala(sida.getViewport({ scale: 1 }), bredd, tathet),
      });
      canvas.width = Math.floor(vy.width);
      canvas.height = Math.floor(vy.height);
      await sida.render({ canvas, viewport: vy }).promise;
    },
    stang: () => dokument.loadingTask.destroy(),
  };
}
