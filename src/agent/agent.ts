import { formatKronor } from '../domain/belopp/ore';
import type { Bokforingstillstand } from '../domain/handelse/handelse';
import type { Uuid } from '../domain/id/uuidv7';
import type { Konto, Kontonummer } from '../domain/konto/konto';
import type { Datum } from '../domain/tid/datum';
import type { Sha256 } from '../domain/underlag/underlag';
import { beteckning } from '../domain/verifikat/verifikat';
import { lasTillstand } from '../data/bokforing';
import type { BokfinkDatabase } from '../data/db';
import { sparaUtkast, type Skrivkontext } from '../data/kommandon';
import { osankta, synka, type Krypto, type Synktransport } from '../data/synk';
import { kopplaUnderlag, sparaUnderlag } from '../data/underlag';
import { forberedUnderlag, underlagsnamn, type Bildkodare } from './fil';
import { granskaForslag, type GranskatForslag } from './forslag';
import { STANDARD_BOKPROFIL, type Bokprofil } from '../domain/bok/bokprofil';
import { tolkaBokbeskrivning } from '../domain/bok/bokbeskrivning';
import { beskrivLage, sok } from './lage';

/**
 * A device with no screen, run by the assistant on the owner's own machine.
 *
 * It joins the sync like the phone does - same server, same passphrase, same
 * log - and it can do exactly one thing to the books: leave a draft with its
 * receipt. It never books, so it never needs a verifikatserie, and every
 * number in the ledger is still handed out by a device a person pressed a
 * button on (hard rule 10).
 *
 * It keeps nothing between runs. Each run reads the whole log from the server
 * into a database in memory, which costs a second or two and removes a
 * second copy of the books from the list of things that can go stale or leak.
 */
export interface Agentberoenden {
  readonly transport: Synktransport;
  readonly krypto: Krypto;
  readonly enhet: string;
  readonly nu: () => string;
  /** Today in Europe/Stockholm; a suggestion dated after it is refused. */
  readonly idag: () => Datum;
  readonly nyttId: () => Uuid;
  readonly hasha: (data: Uint8Array) => Promise<Sha256>;
  readonly lasFil: (sokvag: string) => Promise<Uint8Array>;
  readonly lasText: (sokvag: string) => Promise<string>;
  readonly kodaBild: Bildkodare;
}

/** Which book a command is for, by identity or name; agent.json decides when absent. */
interface Bokval {
  readonly bok?: string;
}

export type Agentkommando =
  | { readonly typ: 'bocker' }
  | ({ readonly typ: 'lage' } & Bokval)
  | ({ readonly typ: 'sok'; readonly fraga: string } & Bokval)
  | ({
      readonly typ: 'utkast';
      readonly sokvag: string;
      readonly prova: boolean;
    } & Bokval)
  | { readonly typ: 'las-nya'; readonly prova: boolean };

export const ANVANDNING = `Användning:
  kontera-agent bocker                   böckerna på servern: namn, slag och identitet
  kontera-agent lage                     bokföringen i korthet: år, frågornas svar, konton, senaste verifikat
  kontera-agent sok <ord>                verifikat vars beskrivning innehåller orden
  kontera-agent utkast --prova <fil>     kontrollera ett förslag utan att skicka något
  kontera-agent utkast <fil>             skicka förslaget som utkast, med underlag, till appen
  kontera-agent las-nya --prova          låt Hermes läsa nya kvitton i alla böcker och visa förslagen
  kontera-agent las-nya                  läs nya kvitton i alla böcker och skicka dem som utkast till appen

  lage, sok och utkast tar --bok <namn eller identitet> för att välja bok.
`;

export function tolkaKommando(argv: readonly string[]): Agentkommando {
  const [kommando, ...alla] = argv;

  // --bok and its value, wherever they stand after the command.
  const plats = alla.indexOf('--bok');
  const bok = plats === -1 ? undefined : alla[plats + 1];
  if (plats !== -1 && (bok === undefined || bok.startsWith('--'))) {
    throw new Error(ANVANDNING);
  }
  const resten =
    plats === -1 ? alla : alla.filter((_, i) => i !== plats && i !== plats + 1);
  const val: Bokval = bok === undefined ? {} : { bok };

  if (kommando === 'bocker' && alla.length === 0) {
    return { typ: 'bocker' };
  }
  if (kommando === 'lage' && resten.length === 0) {
    return { typ: 'lage', ...val };
  }
  if (kommando === 'sok' && resten.length > 0) {
    return { typ: 'sok', fraga: resten.join(' '), ...val };
  }
  if (kommando === 'las-nya' && plats === -1) {
    const ovrigt = resten.filter((del) => del !== '--prova');
    if (ovrigt.length === 0) {
      return { typ: 'las-nya', prova: resten.includes('--prova') };
    }
  }
  if (kommando === 'utkast') {
    const prova = resten.includes('--prova');
    const filer = resten.filter((del) => del !== '--prova');
    if (filer.length === 1 && filer[0] !== undefined) {
      return { typ: 'utkast', sokvag: filer[0], prova, ...val };
    }
  }
  throw new Error(ANVANDNING);
}

/**
 * One command in one book, already chosen. The book list and the watcher,
 * which are about every book, are run from ./bocker instead.
 */
export async function korAgent(
  db: BokfinkDatabase,
  kommando: Exclude<Agentkommando, { typ: 'las-nya' } | { typ: 'bocker' }>,
  beroenden: Agentberoenden,
): Promise<string> {
  await db.open();
  await synkaMed(db, beroenden);
  const bocker = await lasTillstand(db);

  switch (kommando.typ) {
    case 'lage':
      return beskrivLage(bocker, await bokensProfil(beroenden));
    case 'sok':
      return sok(bocker, kommando.fraga);
    case 'utkast':
      return skickaUtkast(db, bocker, kommando, beroenden);
  }
}

/**
 * What kind of book this is, from the description it left on the server.
 *
 * A book with none yet is taken for a firm's, as every book was before
 * profiles; one whose description cannot be read says so (hard rule 11).
 */
async function bokensProfil(beroenden: Agentberoenden): Promise<Bokprofil> {
  const text = await beroenden.transport.bokbeskrivning();
  if (text === undefined || text === '') {
    return STANDARD_BOKPROFIL;
  }
  return tolkaBokbeskrivning(await beroenden.krypto.dekryptera(text)).profil;
}

async function skickaUtkast(
  db: BokfinkDatabase,
  bocker: Bokforingstillstand,
  { sokvag, prova }: { sokvag: string; prova: boolean },
  beroenden: Agentberoenden,
): Promise<string> {
  let json: unknown;
  try {
    json = JSON.parse(await beroenden.lasText(sokvag));
  } catch (orsak) {
    throw new Error(
      `${sokvag} gick inte att läsa som JSON: ${orsak instanceof Error ? orsak.message : String(orsak)}`,
      { cause: orsak },
    );
  }

  const granskat = granskaForslag(json, bocker, beroenden.nyttId(), beroenden.idag());
  const { utkast } = granskat;

  const filer = [];
  for (const [index, fil] of granskat.underlag.entries()) {
    const forberedd = await forberedUnderlag(
      fil,
      underlagsnamn(utkast.datum, utkast.beskrivning, index),
      beroenden.lasFil,
      beroenden.kodaBild,
    );
    const sha256 = await beroenden.hasha(forberedd.data);

    /*
     * The same bytes already in the books and already claimed means this
     * receipt has been sent before. A second draft for it would be booked
     * twice by someone working down a list; an unclaimed copy, photographed
     * in the app and waiting, is fine to attach.
     */
    const redan = [...bocker.underlag.values()].find((post) => post.sha256 === sha256);
    if (redan !== undefined && redan.verifikat.length > 0) {
      const agare = redan.verifikat.map((id) => {
        const verifikat = bocker.verifikat.get(id);
        return verifikat === undefined ? 'ett utkast' : beteckning(verifikat);
      });
      throw new Error(
        `${fil} finns redan i Bokfink och hör till ${agare.join(' och ')}. ` +
          'Inget skickades.',
      );
    }
    filer.push({ ...forberedd, sha256, kalla: fil });
  }

  const sammanfattning = beskrivForslag(granskat, bocker.konton, filer);
  if (prova) {
    return `Förslaget håller. Inget har skickats.\n\n${sammanfattning}`;
  }

  const kontext: Skrivkontext = {
    enhet: beroenden.enhet,
    nu: beroenden.nu,
    nyttId: beroenden.nyttId,
  };

  /*
   * Receipts first, then the draft, then the links. The log is folded in id
   * order, and a link needs its receipt to exist; a run stopped between the
   * steps leaves receipts waiting on their own, which is visible and harmless.
   */
  const nya: Sha256[] = [];
  const underlagIdn: Uuid[] = [];
  for (const fil of filer) {
    const { underlag, nytt } = await sparaUnderlag(db, kontext, fil);
    if (nytt) {
      nya.push(fil.sha256);
    }
    underlagIdn.push(underlag.id);
  }
  await sparaUtkast(db, kontext, utkast);
  for (const id of underlagIdn) {
    await kopplaUnderlag(db, kontext, id, utkast.id);
  }

  await synkaMed(db, beroenden);

  // Checked rather than assumed: the sync reports what it sent, and hard
  // rule 11 wants a draft that did not arrive to say so.
  const kvar = await osankta(db);
  if (kvar > 0) {
    throw new Error(`${kvar} händelser nådde inte servern. Kör kommandot igen.`);
  }
  const paServern = new Set(await beroenden.transport.filadresser());
  const saknas = nya.filter((adress) => !paServern.has(adress));
  if (saknas.length > 0) {
    throw new Error(
      `${saknas.length} underlag nådde inte servern, fast utkastet gjorde det. ` +
        'Kör kommandot igen; det som redan finns skickas inte två gånger.',
    );
  }

  return (
    'Utkastet är skickat. Det syns under Att göra i appen när telefonen har synkat.\n\n' +
    sammanfattning
  );
}

/**
 * The draft as the person approving it should see it, account names included.
 */
function beskrivForslag(
  granskat: GranskatForslag,
  konton: ReadonlyMap<Kontonummer, Konto>,
  filer: readonly { filnamn: string; data: Uint8Array; kalla: string }[],
): string {
  const { utkast, varningar } = granskat;
  return [
    `${utkast.datum} ${utkast.beskrivning}`,
    ...utkast.konteringar.map(
      (rad) =>
        `  ${rad.belopp < 0 ? 'kredit' : 'debet '} ${rad.konto} ${
          konton.get(rad.konto)?.namn ?? ''
        }: ${formatKronor(rad.belopp)}`,
    ),
    ...filer.map(
      (fil) =>
        `  underlag ${fil.filnamn} (${Math.round(fil.data.byteLength / 1024)} kB, från ${fil.kalla})`,
    ),
    ...varningar.map((varning) => `  OBS: ${varning}`),
    '',
  ].join('\n');
}

/**
 * A sync round that sends everything and fetches only the log.
 *
 * This device keeps nothing between runs, so fetching files would mean
 * downloading every receipt in the books on every run - hundreds of megabytes
 * over the years, to show nothing. The transport is asked for files as if
 * the server had none, which the sync treats as nothing to fetch; uploads go
 * through untouched.
 */
export async function synkaMed(
  db: BokfinkDatabase,
  beroenden: Pick<Agentberoenden, 'transport' | 'krypto' | 'enhet' | 'hasha'>,
): Promise<void> {
  const transport: Synktransport = {
    ...beroenden.transport,
    hamtaFil: async () => undefined,
  };
  const resultat = await synka(db, transport, beroenden.krypto, beroenden.enhet, {
    hasha: beroenden.hasha,
  });
  // A draft the server turned away has not reached the app, and saying it
  // was sent would be the one lie this tool must not tell.
  if (resultat.avvisade > 0) {
    throw new Error(resultat.avvisningsorsak ?? 'Servern avvisade en händelse.');
  }
}
