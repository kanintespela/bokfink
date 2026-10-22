import { skrivVerifikationslistaPdf } from '../domain/arkiv/verifikationslistaPdf';
import { skrivZip, type Ziparkivfil } from '../domain/arkiv/zip';
import type { Uuid } from '../domain/id/uuidv7';
import { omfattar } from '../domain/rakenskapsar/rakenskapsar';
import type { Datum } from '../domain/tid/datum';
import type { Sha256, Underlagstyp } from '../domain/underlag/underlag';
import { lasTillstand } from './bokforing';
import type { KonteraDatabase } from './db';
import type { Exportinstallningar } from './sieexport';
import { exporteraSie } from './sieexport';
import { lasFil } from './underlag';

const ANDELSE: Record<Underlagstyp, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export class SkadatUnderlagIArkivError extends Error {
  constructor(filnamn: string) {
    super(
      `Underlaget "${filnamn}" stämmer inte längre med sin kontrollsumma. ` +
        'Arkivpaketet avbröts i stället för att bygga ett paket som redan är skadat.',
    );
    this.name = 'SkadatUnderlagIArkivError';
  }
}

export interface Arkivalternativ {
  /** Injected the same way `importera`'s is - platform belongs to features. */
  readonly hasha: (data: Uint8Array) => Promise<Sha256>;
}

// BFL 7 kap. 1 §: räkenskapsinformation ska kunna tas fram i vanlig läsbar
// form under hela arkiveringstiden. Nothing here needs Kontera to open: the
// SIE file is text, the PDF is a PDF, the receipts are plain JPEG/PNG/WEBP.
function lasmig(foretagsnamn: string, ar: Datum, arSlut: Datum, skapad: Datum): string {
  return (
    `Arkivpaket från Bokfink${foretagsnamn === '' ? '' : ` – ${foretagsnamn}`}\n` +
    `Räkenskapsår: ${ar} – ${arSlut}\n` +
    `Skapat: ${skapad}\n\n` +
    'Innehåll\n' +
    '--------\n\n' +
    'kontera-*.se\n' +
    '    Hela årets bokföring i SIE 4-formatet. Läses in av praktiskt taget\n' +
    '    vilket svenskt bokföringsprogram som helst, eller läses som ren text.\n\n' +
    'verifikationslista.pdf\n' +
    '    Samma bokföring som en läsbar verifikationslista. Öppnas med vilken\n' +
    '    PDF-läsare som helst.\n\n' +
    'underlag/\n' +
    '    Varje kvitto och faktura kopplat till ett verifikat det här året.\n' +
    '    Filerna heter sin egen SHA-256-kontrollsumma, inte sitt ursprungliga\n' +
    '    filnamn.\n\n' +
    'checksummor.txt\n' +
    '    En SHA-256-kontrollsumma per fil i paketet (utom denna rad). Stämmer\n' +
    '    en rad inte med filens innehåll har filen ändrats eller skadats.\n\n' +
    'Bokföringslagen (1999:1078) 7 kap. 1 §: räkenskapsinformation ska kunna\n' +
    'tas fram i vanlig läsbar form under hela arkiveringstiden. Det här\n' +
    'paketet är byggt för att gå att läsa utan Bokfink installerat.\n'
  );
}

/**
 * The seven-year archive package: SIE, a printable verifikationslista, every
 * underlag that year, a checksum per file, and a read-me - zipped into one
 * file that survives leaving Kontera behind entirely.
 *
 * Every included file is checksummed against its own stored hash before it
 * goes in. A receipt that has quietly rotted in IndexedDB must not end up
 * archived as if it were still intact - hard rule 11, applied to the one
 * artifact that has no second chance to notice.
 */
export async function byggArkivpaket(
  db: KonteraDatabase,
  rakenskapsarId: Uuid,
  skapad: Datum,
  alternativ: Arkivalternativ,
  installningar: Exportinstallningar = {},
): Promise<Uint8Array> {
  const tillstand = await lasTillstand(db);
  const ar = tillstand.rakenskapsar.get(rakenskapsarId);
  if (ar === undefined) {
    throw new Error(
      `Det finns inget räkenskapsår med id ${rakenskapsarId} att arkivera.`,
    );
  }

  const iAret = new Set(
    [...tillstand.verifikat.values()]
      .filter((verifikat) => omfattar(ar, verifikat.datum))
      .map((verifikat) => verifikat.id),
  );

  const [sie, pdf] = await Promise.all([
    exporteraSie(db, rakenskapsarId, installningar),
    skrivVerifikationslistaPdf({
      foretagsnamn: installningar.foretagsnamn ?? '',
      rakenskapsar: ar,
      verifikat: [...tillstand.verifikat.values()].filter((v) => iAret.has(v.id)),
      konton: tillstand.konton,
      skapad,
    }),
  ]);

  const filer: Ziparkivfil[] = [
    { namn: `kontera-${ar.start.slice(0, 4)}.se`, data: sie },
    { namn: 'verifikationslista.pdf', data: pdf },
  ];

  const underlagIAret = [...tillstand.underlag.values()].filter((underlag) =>
    underlag.verifikat.some((id) => iAret.has(id)),
  );

  for (const underlag of underlagIAret) {
    const fil = await lasFil(db, underlag.sha256);
    if (fil === undefined) {
      // The log said this underlag exists; the file store disagreeing is a
      // corrupted device, not a normal absence, so it fails the same way a
      // bad checksum does rather than being skipped over quietly.
      throw new SkadatUnderlagIArkivError(underlag.filnamn);
    }
    if ((await alternativ.hasha(fil.data)) !== underlag.sha256) {
      throw new SkadatUnderlagIArkivError(underlag.filnamn);
    }
    filer.push({
      namn: `underlag/${underlag.sha256}.${ANDELSE[underlag.mime]}`,
      data: fil.data,
    });
  }

  filer.push({
    namn: 'LASMIG.txt',
    data: new TextEncoder().encode(
      lasmig(installningar.foretagsnamn ?? '', ar.start, ar.slut, skapad),
    ),
  });

  // Checksummed last, so checksummor.txt itself covers every other file -
  // including the read-me - and only fails to cover itself, which no
  // checksum file can.
  const checksummor = await Promise.all(
    filer.map(async (fil) => `${await alternativ.hasha(fil.data)}  ${fil.namn}`),
  );
  filer.push({
    namn: 'checksummor.txt',
    data: new TextEncoder().encode(`${checksummor.join('\n')}\n`),
  });

  return skrivZip(filer, skapad);
}
