import { forOcr } from './bild';
import { lasPdftext } from './pdf';
import type { Underlagstyp } from '../domain/underlag/underlag';

/**
 * Reading text out of an underlag, on the device.
 *
 * A PDF is read rather than recognised - see ./pdf - and only a photograph
 * goes through the engine below.
 *
 * Tesseract.js (Apache-2.0) compiled to WebAssembly, running in its own Web
 * Worker so the interface stays responsive while a receipt is read. Apple's
 * Vision framework is not reachable from the web and no browser ships a text
 * detector, so this is the only fully local option there is
 * (docs/UTVECKLINGSPLAN.md, section 2).
 *
 * Everything it needs is served from our own origin, never a CDN: the wasm
 * build, the worker and the Swedish language data are copied into public/ by
 * scripts/kopiera-tesseract.mjs.
 */

/** Where the copied engine files are served from. */
const OCR_BAS = '/tesseract';

/**
 * Swedish only, for now.
 *
 * Each language is six megabytes and slows recognition measurably, and a
 * Swedish receipt is Swedish words and Latin digits. English data is one line
 * away if a supplier's invoice ever needs it.
 */
const SPRAK = 'swe';

export interface Ocrresultat {
  readonly text: string;
  /** Tesseract's own confidence, 0-100. Low means the picture, not the text. */
  readonly sakerhet: number;
}

/**
 * Below this the reading is poor enough to be worth a second attempt.
 *
 * The same photograph read at 68 untouched and 84 after local thresholding,
 * and at 68 it had silently dropped four lines. Thresholding wins on a
 * photograph; it can lose on something already clean, like a screenshot or a
 * scan, so a poor result is retried on the original rather than accepted.
 */
const LAG_SAKERHET = 70;

/**
 * Below this the reading is not worth offering at all.
 *
 * Measured on four photographed receipts. The hopeless ones - an A4 shot at
 * an angle with a card slip folded over it, a receipt photographed in a dark
 * car - came back at 36 and 22 and produced confident nonsense: "Totalt exkl.
 * aom 0.00", and a weight in kilos offered as the amount.
 *
 * Deliberately low. Confidence is a poor judge of whether the figures are
 * right - one reading at 43 gave exactly the right total while another at 50
 * glued a digit onto it - so it is used only to rule out the hopeless, and
 * the parser decides the rest.
 */
export const LASBAR_SAKERHET = 40;

/**
 * Below this the reading is worth a warning, even when it is offered.
 *
 * The readable photographs came back at 63 and above; the ones that needed
 * checking sat in the forties.
 */
export const OSAKER_SAKERHET = 60;

type Framsteg = (andel: number) => void;

interface Arbetare {
  recognize(bild: Blob): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<void>;
}

let arbetare: Promise<Arbetare> | undefined;

/**
 * Reads a receipt.
 *
 * The engine is started once and kept: initialising it means fetching and
 * compiling several megabytes of wasm, which is seconds on a phone and would
 * be paid again for every receipt in a batch.
 */
export async function lasKvittotext(
  data: Uint8Array,
  mime: Underlagstyp,
  onFramsteg?: Framsteg,
): Promise<Ocrresultat[]> {
  try {
    return await lasInnehall(data, mime, onFramsteg);
  } catch (orsak) {
    throw lasfel(orsak, mime);
  }
}

/**
 * A failure to read, in words for the person holding the receipt.
 *
 * What the engine says - "undefined is not a function" - means nothing to
 * them, and on its own it reads as though the receipt were lost. It is kept
 * in brackets all the same (hard rule 11): it is what tells a developer which
 * line broke, and it can only be passed on if it is on the screen.
 */
export function lasfel(orsak: unknown, mime: Underlagstyp): Error {
  const vad = mime === 'application/pdf' ? 'i PDF:en' : 'på bilden';
  const tekniskt = orsak instanceof Error ? orsak.message : String(orsak);
  return new Error(
    `Appen kunde inte läsa texten ${vad}. Underlaget är sparat - fyll i ` +
      `uppgifterna för hand. (Tekniskt fel: ${tekniskt})`,
    { cause: orsak },
  );
}

async function lasInnehall(
  data: Uint8Array,
  mime: Underlagstyp,
  onFramsteg?: Framsteg,
): Promise<Ocrresultat[]> {
  if (mime === 'application/pdf') {
    /*
     * A PDF's text is already text, so it is read rather than recognised.
     * Full confidence: nothing was guessed at, the characters are the ones
     * the invoice was written with. A PDF with no text layer is a picture of
     * an invoice and comes back empty, which the caller reports as such.
     */
    const text = await lasPdftext(data);
    onFramsteg?.(1);
    return [{ text, sakerhet: text.trim().length === 0 ? 0 : 100 }];
  }

  const motor = await starta(onFramsteg);
  onFramsteg?.(0.5);

  const behandlad = await forOcr(data, mime).catch(() => undefined);
  const forsta = await las(motor, behandlad ?? blobAv(data, mime));
  onFramsteg?.(0.8);

  /*
   * A second reading, on the untouched picture, when the first went badly.
   * Both are returned rather than one chosen here: which reading is better is
   * a question about the figures in it, and the engine's opinion of itself
   * answers it wrongly often enough to matter - a reading at 43 gave the
   * right total while one at 50 turned 926,00 into 2926,00. The caller has
   * the parser and can tell.
   */
  if (behandlad === undefined || forsta.sakerhet >= LAG_SAKERHET) {
    onFramsteg?.(1);
    return [forsta];
  }

  const andra = await las(motor, blobAv(data, mime));
  onFramsteg?.(1);
  return [forsta, andra];
}

async function las(motor: Arbetare, bild: Blob): Promise<Ocrresultat> {
  const svar = await motor.recognize(bild);
  return { text: svar.data.text, sakerhet: svar.data.confidence };
}

function blobAv(data: Uint8Array, mime: string): Blob {
  return new Blob([data as BlobPart], { type: mime });
}

/** Lets go of the engine and the memory it holds. */
export async function avslutaOcr(): Promise<void> {
  const startad = arbetare;
  arbetare = undefined;
  if (startad !== undefined) {
    await (await startad).terminate();
  }
}

async function starta(onFramsteg?: Framsteg): Promise<Arbetare> {
  if (arbetare === undefined) {
    arbetare = skapa(onFramsteg).catch((orsak: unknown) => {
      // A failed start must not be remembered, or every later attempt would
      // fail with the same stale promise.
      arbetare = undefined;
      throw orsak;
    });
  }
  return arbetare;
}

async function skapa(onFramsteg?: Framsteg): Promise<Arbetare> {
  // Imported here rather than at the top: the engine is two megabytes of
  // JavaScript that no one should pay for by opening the app.
  const { createWorker } = await import('tesseract.js');

  return (await createWorker(SPRAK, 1, {
    workerPath: `${OCR_BAS}/worker.min.js`,
    corePath: `${OCR_BAS}/core`,
    langPath: `${OCR_BAS}/lang`,
    // The language file is shipped gzipped, which is how npm packages it.
    gzip: true,
    logger: (rad: { status: string; progress: number }) => {
      if (
        rad.status === 'loading language traineddata' ||
        rad.status === 'initializing'
      ) {
        // Half the bar is starting the engine, which is the slow part the
        // first time and instant every time after.
        onFramsteg?.(rad.progress * 0.5);
      }
    },
  })) as unknown as Arbetare;
}
