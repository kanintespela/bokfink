#!/usr/bin/env node
/**
 * Serves the built app to tailscale serve, and nothing else.
 *
 *   node servera.mjs ~/kontera-drift/current
 *
 * Written rather than borrowed. Vite's preview server did this job before,
 * but it runs out of a working checkout, so an `npm ci` in the middle of a
 * session could take the app down with it. What is needed is small: files
 * from one directory, the right types, and cache headers that let a new
 * version through.
 *
 * Listens on loopback only. Tailscale terminates HTTPS in front of it, and
 * nothing on the local network has any business reaching it over plain HTTP.
 *
 * The directory is usually a symlink that uppdatera.sh swaps when a new
 * build arrives. It is resolved once per request, so a request is answered
 * entirely from one version even if the swap happens while it is underway.
 */
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const ROT = resolve(process.argv[2] ?? 'dist');
const PORT = Number(process.env.PORT) || 4173;

const TYPER = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  // Tesseract's language data is gzipped and unpacked by Tesseract itself,
  // so it goes out as a file, not with a Content-Encoding.
  '.gz': 'application/gzip',
};

/**
 * Hashed bundles never change under their name and may be kept for good.
 * Everything else - index.html and sw.js above all - is checked on every
 * load, or a phone would go on running the old version after an update.
 */
function cachning(sokvag) {
  return sokvag.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}

/** The file a path names, or undefined if it is missing or outside the root. */
async function hittaFil(rot, sokvag) {
  const kandidat = join(rot, sokvag);
  try {
    const verklig = await realpath(kandidat);
    if (!verklig.startsWith(rot + sep)) {
      return undefined;
    }
    const info = await stat(verklig);
    return info.isFile() ? { sokvag: verklig, info } : undefined;
  } catch {
    return undefined;
  }
}

const server = createServer(async (forfragan, svar) => {
  if (forfragan.method !== 'GET' && forfragan.method !== 'HEAD') {
    svar.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  let sokvag;
  try {
    sokvag = decodeURIComponent(new URL(forfragan.url ?? '/', 'http://x').pathname);
  } catch {
    svar.writeHead(400).end();
    return;
  }

  let rot;
  try {
    rot = await realpath(ROT);
  } catch {
    svar.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    svar.end('Kontera är inte installerad än.\n');
    return;
  }

  /*
   * A path without a file behind it gets the app itself, as Vite's preview
   * did. The service worker answers navigations offline the same way
   * (navigateFallback), so the two never disagree about what a URL is.
   */
  const fil =
    (await hittaFil(rot, sokvag === '/' ? '/index.html' : sokvag)) ??
    (extname(sokvag) === '' ? await hittaFil(rot, '/index.html') : undefined);

  if (fil === undefined) {
    svar.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    svar.end('Finns inte.\n');
    return;
  }

  const etag = `"${fil.info.size.toString(16)}-${Math.floor(fil.info.mtimeMs).toString(16)}"`;
  const huvuden = {
    'Content-Type': TYPER[extname(fil.sokvag)] ?? 'application/octet-stream',
    'Cache-Control': cachning(sokvag),
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  };

  if (forfragan.headers['if-none-match'] === etag) {
    svar.writeHead(304, huvuden).end();
    return;
  }

  svar.writeHead(200, { ...huvuden, 'Content-Length': fil.info.size });
  if (forfragan.method === 'HEAD') {
    svar.end();
    return;
  }
  createReadStream(fil.sokvag)
    .on('error', () => svar.destroy())
    .pipe(svar);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Kontera serveras från ${ROT} på http://127.0.0.1:${PORT}`);
});
