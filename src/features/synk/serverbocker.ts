import {
  OlasligBokbeskrivningError,
  tolkaBokbeskrivning,
  type Bokbeskrivning,
} from '../../domain/bok/bokbeskrivning';

/** A book as the server lists it. The description is the book's own text, perhaps encrypted. */
export interface Serverbok {
  readonly bok: string;
  readonly beskrivning: string;
}

/** The half of the sync's encryption that reading a description needs. */
export type Upplasning = (
  losenfras: string | undefined,
) => Promise<{ dekryptera: (text: string) => Promise<string> }>;

interface Radhuvud {
  readonly id: string;
  /** What the book is called on this device, when it is already here. */
  readonly finnsHarSom: string | undefined;
}

/**
 * One of the server's books, as far as this device can tell what it is.
 *
 * Three cases, because a description is the book's own and may be locked:
 * one this device can read, one that needs a passphrase it does not have,
 * and one that was read and made no sense - which is said, with the reason,
 * rather than hidden (hard rule 11).
 */
export type Serverbokrad =
  | (Radhuvud & {
      readonly slag: 'lasbar';
      readonly beskrivning: Bokbeskrivning;
      /** The passphrase that opened it; undefined when the book syncs unencrypted. */
      readonly losenfras: string | undefined;
    })
  | (Radhuvud & { readonly slag: 'krypterad'; readonly chiffer: string })
  | (Radhuvud & { readonly slag: 'olaslig'; readonly fel: string });

/**
 * Reads the server's list of books with what this device has to read it
 * with.
 *
 * Each description is tried without a passphrase and then with those given -
 * in practice the open book's, since one owner's books tend to share one. A
 * description none of them opens is not an error: it is a book whose
 * passphrase has to be typed before it can be joined.
 */
export async function tolkaServerbocker(
  rader: readonly Serverbok[],
  lokala: readonly { readonly id: string; readonly namn: string }[],
  losenfraser: readonly (string | undefined)[],
  upplasning: Upplasning,
): Promise<Serverbokrad[]> {
  const attProva = [undefined, ...losenfraser.filter((fras) => fras !== undefined)];
  const resultat: Serverbokrad[] = [];

  for (const rad of rader) {
    const huvud: Radhuvud = {
      id: rad.bok,
      finnsHarSom: lokala.find((bok) => bok.id === rad.bok)?.namn,
    };

    let oppnad: { text: string; losenfras: string | undefined } | undefined;
    for (const losenfras of attProva) {
      try {
        const { dekryptera } = await upplasning(losenfras);
        oppnad = { text: await dekryptera(rad.beskrivning), losenfras };
        break;
      } catch {
        // Not this one. What it means when none fits is decided below.
      }
    }
    if (oppnad === undefined) {
      resultat.push({ ...huvud, slag: 'krypterad', chiffer: rad.beskrivning });
      continue;
    }

    try {
      resultat.push({
        ...huvud,
        slag: 'lasbar',
        beskrivning: tolkaBokbeskrivning(oppnad.text),
        losenfras: oppnad.losenfras,
      });
    } catch (orsak) {
      if (!(orsak instanceof OlasligBokbeskrivningError)) {
        throw orsak;
      }
      resultat.push({ ...huvud, slag: 'olaslig', fel: orsak.message });
    }
  }

  return resultat;
}

/**
 * Opens a locked description with a passphrase someone typed.
 *
 * Fails with the decryption's own words when the passphrase is not the
 * book's, which is the answer the person typing it needs.
 */
export async function lasUppServerbok(
  chiffer: string,
  losenfras: string,
  upplasning: Upplasning,
): Promise<Bokbeskrivning> {
  const { dekryptera } = await upplasning(losenfras);
  return tolkaBokbeskrivning(await dekryptera(chiffer));
}
