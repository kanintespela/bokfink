import { formatKronor } from '../domain/belopp/ore';
import type { Bokforingstillstand } from '../domain/handelse/handelse';
import type { Uuid } from '../domain/id/uuidv7';
import type { Datum } from '../domain/tid/datum';
import type { Sha256, Underlag } from '../domain/underlag/underlag';
import type { KonteraDatabase } from '../data/db';
import { sparaUtkast, type Skrivkontext } from '../data/kommandon';
import { osankta, type Krypto, type Synktransport } from '../data/synk';
import { kopplaUnderlag } from '../data/underlag';
import { skapaUtkast } from '../domain/verifikat/verifikat';
import { granskaForslag } from './forslag';
import {
  avlasningsfraga,
  historikFor,
  konteringsfraga,
  kontrolleraAvlasning,
  somForslag,
  tolkaAvlasning,
  tolkaKontering,
} from './lasning';

/**
 * The receipt watcher: receipts photographed in the app become drafts by
 * themselves.
 *
 * Run every few minutes on the server. It finds receipts that belong to no
 * verifikat and no draft, has Claude read each one through Hermes (see
 * ./lasning), checks the answer, and leaves a draft linked to the receipt
 * the owner already has. Then it says so in the owner's chat.
 *
 * It never books (hard rule 10), and it never retries without end: a receipt
 * that could not be read is tried twice and then left for the owner, with
 * the reason sent once. Limits per run and per day keep a fault from turning
 * into hundreds of calls.
 */
export interface Kvittovakt {
  /** Only receipts added on or after this day; older ones were never meant for it. */
  readonly fran: Datum;
  readonly maxPerKorning: number;
  readonly maxPerDygn: number;
  /** Asks the reader one question, with a picture of the receipt or without. */
  readonly las: (
    fraga: string,
    bild?: { readonly data: Uint8Array; readonly mime: string },
  ) => Promise<string>;
  readonly minne: {
    readonly hamta: () => Promise<Vaktminne>;
    readonly spara: (minne: Vaktminne) => Promise<void>;
  };
  /** Tells the owner, in the chat Hermes already uses. */
  readonly meddela: (text: string) => Promise<void>;
}

export interface Forsok {
  readonly antal: number;
  /** ISO 8601 instant of the latest attempt. */
  readonly senast: string;
  /** 'vantar': the reader was out of reach, which is not counted against the receipt. */
  readonly utfall: 'utkast' | 'fel' | 'vantar';
  readonly meddelande: string;
  /** How many runs found the reader out of reach for this receipt. */
  readonly vantat?: number;
}

/** What has been tried, by receipt id. Kept in a file on the server. */
export interface Vaktminne {
  readonly forsok: Readonly<Record<string, Forsok>>;
  /**
   * Since when the reader has been out of reach, once the owner is told.
   * Cleared by the next reading that goes through, so the owner hears once
   * per spell rather than once per run.
   */
  readonly upptagen?: string;
}

/**
 * The reader could not be reached: the owner's Claude quota is spent, or the
 * service is overloaded, or the question timed out waiting for either.
 *
 * Nothing is wrong with the receipt, so it is not counted as a failed
 * attempt - the watcher stops for this run and asks again on the next. On
 * 2026-10-29 a spent quota made the watcher give up on a receipt it would
 * have read a few hours later.
 */
export class LasarenUpptagen extends Error {
  constructor(meddelande: string) {
    super(meddelande);
    this.name = 'LasarenUpptagen';
  }
}

/**
 * How many runs a receipt may wait for the reader before the wait counts as
 * a failure - about an hour at one run every two minutes. A reader that
 * times out on one receipt for good must not hold up the rest for ever.
 */
const MAX_VANTAN = 30;

/**
 * A receipt that is not ready to be read yet, rather than one that failed.
 *
 * The phone sends the entry first and the picture after it, so for a moment
 * the server knows of a receipt it has no file for. That is waiting, not a
 * failed attempt, and does not count towards giving up on it.
 */
class InteRedo extends Error {}

/** How many times a receipt is tried before it is left for the owner. */
const MAX_FORSOK = 2;

export interface Vaktberoenden {
  readonly transport: Synktransport;
  readonly krypto: Krypto;
  readonly enhet: string;
  readonly nu: () => string;
  readonly idag: () => Datum;
  readonly nyttId: () => Uuid;
  readonly hasha: (data: Uint8Array) => Promise<Sha256>;
  readonly synka: () => Promise<void>;
  readonly vakt: Kvittovakt;
}

/** The receipts waiting for a reading, oldest first, within the day's limits. */
export function kvittonAttLasa(
  underlag: Iterable<Underlag>,
  minne: Vaktminne,
  vakt: Pick<Kvittovakt, 'fran' | 'maxPerKorning' | 'maxPerDygn'>,
  idag: Datum,
): Underlag[] {
  const idagForsokta = Object.values(minne.forsok).filter((forsok) =>
    forsok.senast.startsWith(idag),
  ).length;
  const kvar = Math.max(0, Math.min(vakt.maxPerKorning, vakt.maxPerDygn - idagForsokta));

  return [...underlag]
    .filter((post) => post.verifikat.length === 0)
    .filter((post) => post.tillagd.slice(0, 10) >= vakt.fran)
    .filter((post) => {
      const forsok = minne.forsok[post.id];
      return (
        forsok === undefined ||
        forsok.utfall === 'vantar' ||
        (forsok.utfall === 'fel' && forsok.antal < MAX_FORSOK)
      );
    })
    .sort((a, b) => a.tillagd.localeCompare(b.tillagd))
    .slice(0, kvar);
}

export async function lasNyaKvitton(
  db: KonteraDatabase,
  bocker: Bokforingstillstand,
  prova: boolean,
  beroenden: Vaktberoenden,
): Promise<string> {
  const { vakt } = beroenden;
  const minne = await vakt.minne.hamta();
  const kvitton = kvittonAttLasa(bocker.underlag.values(), minne, vakt, beroenden.idag());
  if (kvitton.length === 0) {
    return 'Inga nya kvitton att läsa.\n';
  }

  const rapport: string[] = [];
  let forsok = { ...minne.forsok };
  let upptagen = minne.upptagen;
  const spara = () =>
    vakt.minne.spara({ forsok, ...(upptagen === undefined ? {} : { upptagen }) });

  for (const kvitto of kvitton) {
    const tidigare = forsok[kvitto.id];
    try {
      const resultat = await lasEtt(db, bocker, kvitto, prova, beroenden);
      rapport.push(resultat.text);
      if (!prova) {
        forsok = {
          ...forsok,
          [kvitto.id]: {
            antal: (tidigare?.antal ?? 0) + 1,
            senast: beroenden.nu(),
            utfall: 'utkast',
            meddelande: resultat.sammanfattning,
          },
        };
        upptagen = undefined;
        await spara();
        await meddela(vakt, resultat.text);
      }
    } catch (orsak) {
      if (orsak instanceof InteRedo) {
        rapport.push(`Kvittot ${kvitto.filnamn} väntar: ${orsak.message}`);
        continue;
      }
      const vantat = (tidigare?.vantat ?? 0) + 1;
      if (orsak instanceof LasarenUpptagen && vantat <= MAX_VANTAN) {
        rapport.push(`Assistenten når inte Claude just nu: ${orsak.message}`);
        if (!prova) {
          forsok = {
            ...forsok,
            [kvitto.id]: {
              antal: tidigare?.antal ?? 0,
              senast: beroenden.nu(),
              utfall: 'vantar',
              meddelande: orsak.message,
              vantat,
            },
          };
          if (upptagen === undefined) {
            upptagen = beroenden.nu();
            await meddela(
              vakt,
              `Assistenten når inte Claude just nu (${orsak.message}). Kvitton som ` +
                'fotas läses så snart det går igen.',
            );
          }
          await spara();
        }
        // The next receipt would meet the same wall.
        break;
      }
      const fel = orsak instanceof Error ? orsak.message : String(orsak);
      const text = `Kvittot ${kvitto.filnamn} kunde inte läsas: ${fel}`;
      rapport.push(text);
      if (!prova) {
        const antal = (tidigare?.antal ?? 0) + 1;
        forsok = {
          ...forsok,
          [kvitto.id]: { antal, senast: beroenden.nu(), utfall: 'fel', meddelande: fel },
        };
        await spara();
        // Said once, when it is given up on; a first failure is tried again.
        if (antal >= MAX_FORSOK) {
          await meddela(vakt, `${text}\nBokför det för hand under Kvitton.`);
        }
      }
    }
  }

  return `${rapport.join('\n\n')}\n`;
}

/** A message that could not be sent is said where the run is logged, not thrown. */
async function meddela(vakt: Kvittovakt, text: string): Promise<void> {
  try {
    await vakt.meddela(text);
  } catch (orsak) {
    process.stderr.write(
      `Meddelandet kunde inte skickas: ${orsak instanceof Error ? orsak.message : String(orsak)}\n`,
    );
  }
}

async function lasEtt(
  db: KonteraDatabase,
  bocker: Bokforingstillstand,
  kvitto: Underlag,
  prova: boolean,
  beroenden: Vaktberoenden,
): Promise<{ text: string; sammanfattning: string }> {
  const data = await hamtaKvitto(kvitto, beroenden);
  const idag = beroenden.idag();

  const kontrollerad = kontrolleraAvlasning(
    tolkaAvlasning(
      await beroenden.vakt.las(avlasningsfraga(), { data, mime: kvitto.mime }),
    ),
  );
  const historik = historikFor(
    kontrollerad.avlasning,
    bocker.underlag.values(),
    bocker.verifikat,
    idag,
  );
  const kontering = tolkaKontering(
    await beroenden.vakt.las(
      konteringsfraga(kontrollerad.avlasning, historik, bocker.konton),
    ),
  );

  const granskat = granskaForslag(
    // The receipt is already in the books; granskaForslag only wants a name.
    { ...somForslag(kontrollerad, kontering), underlag: [kvitto.filnamn] },
    bocker,
    beroenden.nyttId(),
    idag,
  );
  const varningar = [...granskat.varningar];
  if (kontrollerad.avlasning.betalsatt === 'faktura') {
    varningar.push(
      'Det är en faktura. Bokför du med kontantmetoden ska den ha datumet då den betalades.',
    );
  }
  if (kontrollerad.avlasning.sakerhet === 'lag') {
    varningar.push(`Läsningen var osäker: ${kontrollerad.avlasning.kommentar}`);
  }

  // The reasons travel with the draft, so the review in the app can see
  // them - and the warnings with them, since a possible duplicate is the
  // one thing the review must not miss.
  const utkast = skapaUtkast({
    ...granskat.utkast,
    motivering: [kontering.motivering, ...varningar.map((varning) => `OBS: ${varning}`)]
      .join(' ')
      .trim(),
  });

  const sammanfattning = `${utkast.beskrivning}, ${formatKronor(kontrollerad.betalat)} kr, ${utkast.datum}`;
  const text = [
    `${prova ? 'Förslag (inget skickat)' : 'Nytt utkast'}: ${sammanfattning}`,
    ...utkast.konteringar.map(
      (rad) =>
        `  ${rad.konto} ${bocker.konton.get(rad.konto)?.namn ?? ''}: ${formatKronor(rad.belopp)}`,
    ),
    `Varför: ${kontering.motivering}`,
    ...varningar.map((varning) => `OBS: ${varning}`),
    ...(prova ? [] : ['Granska och bokför under Kvitton i Bokfink.']),
  ].join('\n');

  if (prova) {
    return { text, sammanfattning };
  }

  const kontext: Skrivkontext = {
    enhet: beroenden.enhet,
    nu: beroenden.nu,
    nyttId: beroenden.nyttId,
  };
  // The draft, then the link to the receipt the owner photographed. A run
  // stopped between the two leaves a draft without a receipt, which shows.
  await sparaUtkast(db, kontext, utkast);
  await kopplaUnderlag(db, kontext, kvitto.id, utkast.id);
  await beroenden.synka();
  const kvar = await osankta(db);
  if (kvar > 0) {
    throw new Error(
      `${kvar} händelser nådde inte servern. Utkastet kommer vid nästa körning.`,
    );
  }
  return { text, sammanfattning };
}

/**
 * The receipt's bytes, from the server.
 *
 * Sent without a passphrase they are the file itself; with one, an envelope.
 * The address settles which, as in the sync, and what comes back is checked
 * against it - a picture that is not the receipt it claims to be is not read.
 */
async function hamtaKvitto(
  kvitto: Underlag,
  beroenden: Vaktberoenden,
): Promise<Uint8Array> {
  const chiffer = await beroenden.transport.hamtaFil(kvitto.sha256);
  if (chiffer === undefined) {
    throw new InteRedo(
      'filen finns inte på servern än. Den läses när telefonen har synkat.',
    );
  }
  if ((await beroenden.hasha(chiffer)) === kvitto.sha256) {
    return chiffer;
  }
  const data = await beroenden.krypto.dekrypteraFil(chiffer);
  if ((await beroenden.hasha(data)) !== kvitto.sha256) {
    throw new Error('Filen på servern stämmer inte med kvittots kontrollsumma.');
  }
  return data;
}
