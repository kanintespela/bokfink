/*
 * The command-line entry for the receipt assistant's device. Node only: this
 * file is bundled by vite.agent.config.ts and never reaches the app.
 *
 * IndexedDB comes from fake-indexeddb, which keeps it in memory. That is the
 * point rather than a compromise - see src/agent/agent.ts.
 */
import 'fake-indexeddb/auto';

import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { KonteraDatabase } from '../data/db';
import { newIdentifier } from '../data/id';
import { hashaFil } from '../platform/hash';
import { systemklocka } from '../platform/klocka';
import { loggaIn, pocketbaseTransport } from '../platform/pocketbase';
import { synkkrypto } from '../platform/synkkrypto';
import { korAgent, tolkaKommando } from './agent';
import type { Bildkodare } from './fil';
import { tolkaKonfig, tolkaVaktkonfig, type Vaktkonfig } from './konfig';
import { LasarenUpptagen, type Kvittovakt, type Vaktminne } from './vakt';
import { datum } from '../domain/tid/datum';

const KONFIG =
  process.env['KONTERA_AGENT_KONFIG'] ??
  join(homedir(), '.config', 'kontera', 'agent.json');

async function main(): Promise<void> {
  const kommando = tolkaKommando(process.argv.slice(2));

  const [info, text] = await Promise.all([stat(KONFIG), readFile(KONFIG, 'utf8')]).catch(
    () => {
      throw new Error(
        `Hittar ingen inställningsfil på ${KONFIG}. Se .claude/skills/kvitto/SKILL.md ` +
          'för hur den skrivs.',
      );
    },
  );
  const konfig = tolkaKonfig(KONFIG, { lage: info.mode, text });
  const vaktkonfig = await readFile(VAKTKONFIG, 'utf8').then(
    (vakttext) => tolkaVaktkonfig(VAKTKONFIG, vakttext),
    () => undefined,
  );

  const inloggning = await loggaIn(konfig.url, konfig.epost, konfig.losenord);
  const utdata = await korAgent(new KonteraDatabase('kontera-agent'), kommando, {
    transport: pocketbaseTransport(inloggning),
    krypto: await synkkrypto(konfig.losenfras),
    enhet: konfig.enhet,
    nu: () => new Date().toISOString(),
    idag: () => systemklocka().idag(),
    nyttId: () => newIdentifier(),
    hasha: hashaFil,
    lasFil: async (sokvag) => new Uint8Array(await readFile(sokvag)),
    lasText: (sokvag) => readFile(sokvag, 'utf8'),
    kodaBild: magick,
    ...(vaktkonfig === undefined ? {} : { vakt: kvittovakt(vaktkonfig) }),
  });
  process.stdout.write(utdata);
}

/**
 * ImageMagick does the re-encoding the phone does in a canvas.
 *
 * A system tool rather than an npm dependency: it is already on the machine
 * this runs on, it reads HEIC, and nothing of it ends up in the app bundle.
 * `-auto-orient` before `-strip`, so the picture is turned the way the camera
 * held it before the orientation tag is thrown away with the rest of EXIF.
 */
const magick: Bildkodare = (sokvag, { maxKant, kvalitet }) =>
  new Promise((losa, avvisa) => {
    execFile(
      'magick',
      [
        sokvag,
        '-auto-orient',
        '-resize',
        `${maxKant}x${maxKant}>`,
        '-quality',
        String(Math.round(kvalitet * 100)),
        '-strip',
        'jpg:-',
      ],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
      (fel, utdata, felutdata) => {
        if (fel !== null) {
          avvisa(
            new Error(
              (fel as NodeJS.ErrnoException).code === 'ENOENT'
                ? 'ImageMagick (kommandot magick) saknas, och bilden kan inte förberedas.'
                : `Bilden ${sokvag} gick inte att läsa: ${felutdata.toString().trim()}`,
            ),
          );
          return;
        }
        losa(new Uint8Array(utdata));
      },
    );
  });

const VAKTKONFIG =
  process.env['KONTERA_KVITTOVAKT_KONFIG'] ??
  join(homedir(), '.config', 'kontera', 'kvittovakt.json');

/** Where the watcher remembers what it has tried; readable by the owner only. */
const VAKTMINNE =
  process.env['KONTERA_KVITTOVAKT_MINNE'] ??
  join(homedir(), '.local', 'state', 'bokfink', 'kvittovakt.json');

/** How long one question may take before the reading is counted as failed. */
const HERMES_TIDSGRANS_MS = 4 * 60 * 1000;

function kvittovakt(installning: Vaktkonfig): Kvittovakt {
  return {
    fran: datum(installning.fran),
    maxPerKorning: installning.maxPerKorning,
    maxPerDygn: installning.maxPerDygn,
    las: (fraga, bild) => fragaHermes(installning.hermes, fraga, bild),
    minne: {
      hamta: async () => {
        try {
          return JSON.parse(await readFile(VAKTMINNE, 'utf8')) as Vaktminne;
        } catch {
          return { forsok: {} };
        }
      },
      spara: async (minne) => {
        await mkdir(dirname(VAKTMINNE), { recursive: true, mode: 0o700 });
        await writeFile(VAKTMINNE, JSON.stringify(minne, null, 1), { mode: 0o600 });
      },
    },
    meddela: async (text) => {
      if (installning.avisering !== undefined) {
        await kommando(installning.hermes, [
          'send',
          '-q',
          '-t',
          installning.avisering,
          text,
        ]);
      }
    },
  };
}

/**
 * One question to Claude, through the owner's Hermes.
 *
 * One-shot, with Hermes' own memory and instructions left out (--ignore-rules)
 * and no tool but looking at the picture (-t vision). A receipt is text
 * someone else wrote, and an agent that can run commands should not be the
 * one reading it; this one can only answer, and the answer is checked.
 */
async function fragaHermes(
  hermes: string,
  fraga: string,
  bild?: { readonly data: Uint8Array; readonly mime: string },
): Promise<string> {
  const katalog = await mkdtemp(join(tmpdir(), 'bokfink-kvitto-'));
  try {
    await chmod(katalog, 0o700);
    const fragefil = join(katalog, 'fraga.txt');
    await writeFile(fragefil, fraga, { mode: 0o600 });
    const argv = ['chat', '--oneshot', '-Q', '--ignore-rules', '-t', 'vision'];
    argv.push('--query-file', fragefil);
    if (bild !== undefined) {
      argv.push('--image', await somBild(katalog, bild));
    }
    try {
      return await kommando(hermes, argv);
    } catch (orsak) {
      throw tolkaHermesfel(orsak);
    }
  } finally {
    await rm(katalog, { recursive: true, force: true });
  }
}

/**
 * The receipt as one picture: a photo turned upright and kept below 2000 px,
 * a PDF's first two pages stacked into one image.
 */
async function somBild(
  katalog: string,
  { data, mime }: { readonly data: Uint8Array; readonly mime: string },
): Promise<string> {
  const original = join(katalog, mime === 'application/pdf' ? 'kvitto.pdf' : 'kvitto');
  await writeFile(original, data, { mode: 0o600 });
  const bild = join(katalog, 'kvitto.png');
  if (mime === 'application/pdf') {
    await kommando('pdftoppm', [
      '-r',
      '150',
      '-png',
      '-f',
      '1',
      '-l',
      '2',
      original,
      join(katalog, 'sida'),
    ]);
    const sidor = (await readdir(katalog))
      .filter((namn) => namn.startsWith('sida') && namn.endsWith('.png'))
      .sort()
      .map((namn) => join(katalog, namn));
    await kommando('magick', [...sidor, '-append', bild]);
  } else {
    await kommando('magick', [original, '-auto-orient', '-resize', '2000x2000>', bild]);
  }
  return bild;
}

/**
 * A failed question, sorted: the reader out of reach is waited out, anything
 * else is a failure of this reading.
 *
 * Hermes asks Claude on the owner's subscription. When the quota is spent
 * it gets a 429 and waits ten minutes before asking again, longer than the
 * time a question is allowed here - so a question cut off by the time limit
 * is counted as the reader being out of reach, as is a 429 or an overload
 * that Hermes reports itself.
 */
function tolkaHermesfel(orsak: unknown): Error {
  const text = orsak instanceof Error ? orsak.message : String(orsak);
  if (orsak instanceof Kommandofel && orsak.avbruten) {
    return new LasarenUpptagen('frågan tog för lång tid, troligen är kvoten slut');
  }
  if (/\b429\b|rate.?limit|overloaded|\b529\b/i.test(text)) {
    return new LasarenUpptagen('kvoten för Claude är slut för stunden');
  }
  return orsak instanceof Error ? orsak : new Error(text);
}

class Kommandofel extends Error {
  constructor(
    meddelande: string,
    /** Stopped by the time limit rather than failing on its own. */
    readonly avbruten: boolean,
  ) {
    super(meddelande);
  }
}

/** Runs a program and gives back what it printed, or says why it failed. */
function kommando(program: string, argv: readonly string[]): Promise<string> {
  return new Promise((losa, avvisa) => {
    execFile(
      program,
      argv,
      { timeout: HERMES_TIDSGRANS_MS, maxBuffer: 16 * 1024 * 1024 },
      (fel, utdata, felutdata) => {
        if (fel !== null) {
          avvisa(
            new Kommandofel(
              (fel as NodeJS.ErrnoException).code === 'ENOENT'
                ? `Programmet ${program} saknas på den här datorn.`
                : `${program} misslyckades: ${
                    `${String(felutdata).trim()} ${String(utdata).trim()}`.trim() ||
                    fel.message
                  }`,
              fel.killed === true,
            ),
          );
          return;
        }
        losa(String(utdata));
      },
    );
  });
}

main().catch((orsak: unknown) => {
  process.stderr.write(`${orsak instanceof Error ? orsak.message : String(orsak)}\n`);
  process.exitCode = 1;
});
