/*
 * The command-line entry for the receipt assistant's device. Node only: this
 * file is bundled by vite.agent.config.ts and never reaches the app.
 *
 * IndexedDB comes from fake-indexeddb, which keeps it in memory. That is the
 * point rather than a compromise - see src/agent/agent.ts.
 */
import 'fake-indexeddb/auto';

import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { KonteraDatabase } from '../data/db';
import { newIdentifier } from '../data/id';
import { hashaFil } from '../platform/hash';
import { systemklocka } from '../platform/klocka';
import { loggaIn, pocketbaseTransport } from '../platform/pocketbase';
import { synkkrypto } from '../platform/synkkrypto';
import { korAgent, tolkaKommando } from './agent';
import type { Bildkodare } from './fil';
import { tolkaKonfig } from './konfig';

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

main().catch((orsak: unknown) => {
  process.stderr.write(`${orsak instanceof Error ? orsak.message : String(orsak)}\n`);
  process.exitCode = 1;
});
