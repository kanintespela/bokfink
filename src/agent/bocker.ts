import { arMomsregistrerad } from '../domain/bok/bokprofil';
import { tolkaBokbeskrivning, type Bokbeskrivning } from '../domain/bok/bokbeskrivning';
import type { Datum } from '../domain/tid/datum';
import { lasTillstand } from '../data/bokforing';
import type { BokfinkDatabase } from '../data/db';
import type { Synktransport } from '../data/synk';
import { synkaMed, type Agentberoenden } from './agent';
import { lasNyaKvitton, type Kvittovakt } from './vakt';

/** One of the server's books, as the watcher meets it. */
export interface Bokpaserver {
  readonly id: string;
  /** As the book left it on the server: JSON, ciphertext, or nothing yet. */
  readonly beskrivning: string | undefined;
  readonly transport: Synktransport;
}

/** What the owner has said about one book in kvittovakt.json. */
export interface Bokinstallning {
  /** The book's name as it stands on invoices to it. */
  readonly foretag?: string;
  /** Only receipts added on or after this day; the watcher's own when absent. */
  readonly fran?: Datum;
  /** False leaves the book alone, as for a book kept only to try things in. */
  readonly vakta: boolean;
}

export interface Allabokberoenden extends Omit<Agentberoenden, 'transport'> {
  /**
   * The watcher's reader, limits and memory. Its `foretag` is the firm's name,
   * used for a firm's book that names none of its own.
   */
  readonly vakt: Kvittovakt;
  readonly installning: (bok: string) => Bokinstallning | undefined;
  /** A database of its own for each book, so that no two books' logs meet. */
  readonly nyDb: (bok: string) => BokfinkDatabase;
}

/** A book the watcher cannot read receipts for, with the reason. */
class Hoppas extends Error {}

/**
 * The receipt watcher over every book on the server (beslut AE).
 *
 * A receipt photographed in the app lands in the book that was open, so the
 * book it belongs to is settled before the watcher sees it: nothing has to
 * follow which book is open on which device. What kind of book it is - firm
 * or association, kontant- or faktureringsmetoden, with or without moms -
 * comes from the description the book leaves on the server, which is what
 * every joining device trusts too.
 *
 * The run's limit is shared by all books, the day's limit too since the
 * memory is, and a reader out of reach ends the run: the next book would meet
 * the same wall.
 */
export async function vaktaAllaBocker(
  bocker: readonly Bokpaserver[],
  prova: boolean,
  beroenden: Allabokberoenden,
): Promise<string> {
  const { vakt } = beroenden;
  const vaktade = bocker.filter((bok) => beroenden.installning(bok.id)?.vakta !== false);
  if (vaktade.length === 0) {
    return 'Inga böcker att läsa kvitton i.\n';
  }
  const flera = vaktade.length > 1;

  const rapport: string[] = [];
  let forsokta = 0;
  for (const bok of vaktade) {
    if (forsokta >= vakt.maxPerKorning) {
      break;
    }
    const egen = beroenden.installning(bok.id);

    let beskrivning: Bokbeskrivning;
    try {
      beskrivning = await lasBeskrivning(bok, beroenden);
    } catch (orsak) {
      if (!(orsak instanceof Hoppas)) {
        throw orsak;
      }
      rapport.push(`Boken ${bok.id} läses inte: ${orsak.message}`);
      await hoppaOver(bok.id, `Boken ${bok.id}`, orsak.message, prova, vakt);
      continue;
    }
    const namn = beskrivning.namn;

    /*
     * A registered association's moms has to be divided over a mixed activity,
     * which the app does not work out, so it has no booking questions of its
     * own and the watcher must not suggest bookings for it (hard rule 11).
     */
    if (
      beskrivning.profil === 'forening' &&
      arMomsregistrerad(beskrivning.profil, beskrivning.momsregistrerad)
    ) {
      const skal =
        'kvittovakten stöder ännu inte en momsregistrerad förening; bokför dess kvitton för hand';
      rapport.push(`${namn} läses inte: ${skal}`);
      await hoppaOver(bok.id, namn, skal, prova, vakt);
      continue;
    }
    if (!prova) {
      await glomOverhoppad(bok.id, vakt);
    }

    const foretag =
      egen?.foretag ??
      (beskrivning.profil === 'enskild_firma' ? vakt.foretag : undefined);
    const bokensVakt: Kvittovakt = {
      maxPerDygn: vakt.maxPerDygn,
      las: vakt.las,
      minne: vakt.minne,
      fran: egen?.fran ?? vakt.fran,
      maxPerKorning: vakt.maxPerKorning - forsokta,
      profil: beskrivning.profil,
      metod: beskrivning.redovisningsmetod ?? 'kontantmetoden',
      ...(foretag === undefined ? {} : { foretag }),
      // With more than one book the owner has to know which one to open.
      meddela: flera ? (text) => vakt.meddela(`${namn}: ${text}`) : vakt.meddela,
    };

    const db = beroenden.nyDb(bok.id);
    await db.open();
    const bokberoenden = { ...beroenden, transport: bok.transport };
    await synkaMed(db, bokberoenden);
    const resultat = await lasNyaKvitton(db, await lasTillstand(db), prova, {
      ...bokberoenden,
      vakt: bokensVakt,
      synka: () => synkaMed(db, bokberoenden),
    });

    rapport.push(
      flera ? `${namn}:\n${resultat.text.trimEnd()}` : resultat.text.trimEnd(),
    );
    forsokta += resultat.forsokta;
    if (resultat.upptagen) {
      break;
    }
  }

  return `${rapport.join('\n\n')}\n`;
}

/**
 * The book's description, opened with the same passphrase as its log.
 *
 * The profile decides which questions the reader is asked and which accounts
 * it may suggest, so a book that does not say what it is is left alone rather
 * than read as a firm's.
 */
async function lasBeskrivning(
  bok: Bokpaserver,
  beroenden: Pick<Agentberoenden, 'krypto'>,
): Promise<Bokbeskrivning> {
  if (bok.beskrivning === undefined || bok.beskrivning === '') {
    throw new Hoppas(
      'den säger inte på servern vilket slags bok den är. Öppna den i appen med synken på, ' +
        'så skickas det.',
    );
  }
  let text: string;
  try {
    text = await beroenden.krypto.dekryptera(bok.beskrivning);
  } catch {
    throw new Hoppas('den är låst med en lösenfras som agent.json inte har.');
  }
  try {
    return tolkaBokbeskrivning(text);
  } catch (orsak) {
    throw new Hoppas(orsak instanceof Error ? orsak.message : String(orsak));
  }
}

/** Tells the owner once that a book is left out, and why. */
async function hoppaOver(
  bok: string,
  namn: string,
  skal: string,
  prova: boolean,
  vakt: Kvittovakt,
): Promise<void> {
  if (prova) {
    return;
  }
  const minne = await vakt.minne.hamta();
  if (minne.overhoppade?.[bok] === skal) {
    return;
  }
  await vakt.minne.spara({
    ...minne,
    overhoppade: { ...minne.overhoppade, [bok]: skal },
  });
  try {
    await vakt.meddela(`Kvitton i ${namn} läses inte: ${skal}`);
  } catch (orsak) {
    process.stderr.write(
      `Meddelandet kunde inte skickas: ${orsak instanceof Error ? orsak.message : String(orsak)}\n`,
    );
  }
}

async function glomOverhoppad(bok: string, vakt: Kvittovakt): Promise<void> {
  const minne = await vakt.minne.hamta();
  if (minne.overhoppade?.[bok] === undefined) {
    return;
  }
  const kvar = Object.fromEntries(
    Object.entries(minne.overhoppade).filter(([id]) => id !== bok),
  );
  await vakt.minne.spara({ ...minne, overhoppade: kvar });
}
