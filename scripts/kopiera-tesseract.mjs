/*
 * Copies the OCR engine's and the PDF reader's own files out of node_modules
 * and into public/.
 *
 * Hard rule 7: nothing is fetched from a CDN in operation, so the wasm build,
 * the worker and the Swedish language data have to be served from the app's
 * own origin. They are copied rather than committed - twenty megabytes of
 * binaries in git would be paid for on every clone forever, and npm already
 * has them pinned in package-lock.json.
 *
 * Run before dev, build and the e2e suite. Copying is skipped when the file
 * is already there and the same size, so it costs nothing on a warm tree.
 */
import { createRequire } from 'node:module';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const kravDir = (paket) => dirname(require.resolve(`${paket}/package.json`));

const MAL = 'public/tesseract';
const PDFMAL = 'public/pdf';

/*
 * The lstm builds only. Tesseract's older "legacy" engine is a second model
 * we never ask for, and shipping both would double what a phone downloads.
 * All three instruction-set variants are copied - plain, SIMD and relaxed
 * SIMD - because tesseract.js probes what the browser supports and asks for
 * one of them by name at runtime. Leaving one out means the engine fails on
 * exactly the devices that would have run it fastest.
 */
const KARNFILER = [
  'tesseract-core-lstm.wasm',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
];

async function kopiera(fran, till) {
  await mkdir(dirname(till), { recursive: true });
  const [kalla, befintlig] = await Promise.all([
    stat(fran),
    stat(till).catch(() => undefined),
  ]);
  if (befintlig !== undefined && befintlig.size === kalla.size) {
    return false;
  }
  await copyFile(fran, till);
  return true;
}

const tesseract = kravDir('tesseract.js');
const pdf = kravDir('pdfjs-dist');
const karna = kravDir('tesseract.js-core');
const svenska = kravDir('@tesseract.js-data/swe');

const jobb = [
  [join(tesseract, 'dist', 'worker.min.js'), join(MAL, 'worker.min.js')],
  /*
   * pdf.js parses in a worker of its own, so the parsing of a supplier's
   * invoice does not freeze the screen it is being read into. Its cmaps are
   * needed for PDFs whose fonts are CID-encoded, which is most of what an
   * invoicing system produces.
   *
   * The legacy build's worker, to match the legacy build src/platform/pdf.ts
   * imports - the default one needs a newer Safari than a phone may have.
   */
  [
    join(pdf, 'legacy', 'build', 'pdf.worker.min.mjs'),
    join(PDFMAL, 'pdf.worker.min.mjs'),
  ],
  ...KARNFILER.map((namn) => [join(karna, namn), join(MAL, 'core', namn)]),
  [join(svenska, '4.0.0', 'swe.traineddata.gz'), join(MAL, 'lang', 'swe.traineddata.gz')],
];

let kopierade = 0;
for (const [fran, till] of jobb) {
  if (await kopiera(fran, till)) {
    kopierade += 1;
  }
}

// The cmaps are a directory of small files rather than one named asset.
const cmapKalla = join(pdf, 'cmaps');
for (const namn of await readdir(cmapKalla)) {
  if (await kopiera(join(cmapKalla, namn), join(PDFMAL, 'cmaps', namn))) {
    kopierade += 1;
  }
}

console.log(
  kopierade === 0
    ? `OCR- och PDF-filerna finns redan i ${MAL} och ${PDFMAL}.`
    : `Kopierade ${kopierade} filer till ${MAL} och ${PDFMAL}.`,
);
