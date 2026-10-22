import { ore, type Ore } from '../belopp/ore';
import { datum, datumAv, type Datum } from '../tid/datum';

/**
 * Reading a bank statement exported as CSV.
 *
 * Every Swedish bank exports something slightly different: the separator, the
 * column names, the order and the direction of the sign all vary, and some
 * put four lines of account details above the header. Rather than one parser
 * per bank - a list that is wrong the moment a bank changes its export - the
 * columns are found by name from the words the banks actually use, and
 * anything not recognised is refused by name so it can be added.
 *
 * Nothing here books anything. A statement is a list of things that have
 * happened, and hard rule 10 leaves the booking to the person.
 */

export interface Banktransaktion {
  readonly datum: Datum;
  readonly text: string;
  /** Positive into the account, negative out of it. */
  readonly belopp: Ore;
  /** The balance after the transaction, when the statement carries one. */
  readonly saldo?: Ore;
}

export class OlasbartKontoutdragError extends Error {
  constructor(orsak: string) {
    super(`Kontoutdraget går inte att läsa: ${orsak}`);
    this.name = 'OlasbartKontoutdragError';
  }
}

/**
 * Column headings the Swedish banks use, folded and without spaces.
 *
 * More than one spelling per column on purpose: Swedbank writes
 * "Transaktionsdag", Handelsbanken "Transaktionsdatum", SEB "Bokföringsdatum",
 * and an export edited in a spreadsheet can have any of them.
 */
const KOLUMNER = {
  /*
   * Bokföringsdagen first, because that is the day the account changed and
   * therefore the day the money moved. Transaktionsdagen - when the card was
   * used - can be a few days earlier, which the matching's date margin
   * absorbs.
   */
  datum: [
    'bokforingsdag',
    'bokforingsdatum',
    'transaktionsdag',
    'transaktionsdatum',
    'datum',
  ],
  /*
   * In the order they are worth having. A statement often carries both a
   * "Referens" saying "Kortköp" and a "Beskrivning" naming the shop, and the
   * shop is the half that tells one purchase from another.
   */
  text: [
    'beskrivning',
    'text',
    'mottagare',
    'meddelande',
    'transaktion',
    'rubrik',
    'referens',
  ],
  belopp: ['belopp', 'summa', 'transaktionsbelopp'],
  saldo: ['saldo', 'bokfortsaldo'],
} as const;

/** Reads a statement, or says what it could not find. */
export function lasKontoutdrag(text: string): Banktransaktion[] {
  const rader = delaRader(text);
  if (rader.length === 0) {
    throw new OlasbartKontoutdragError('filen är tom.');
  }

  const avgransare = hittaAvgransare(rader);
  const tabell = rader.map((rad) => delaFalt(rad, avgransare));

  const rubrikrad = tabell.findIndex((falt) => hittarKolumner(falt) !== undefined);
  if (rubrikrad === -1) {
    throw new OlasbartKontoutdragError(
      'ingen rad med rubrikerna datum, text och belopp hittades. Exportera ' +
        'utdraget som CSV med rubriker från banken.',
    );
  }

  const kolumner = hittarKolumner(tabell[rubrikrad] ?? [])!;

  const transaktioner: Banktransaktion[] = [];
  for (const falt of tabell.slice(rubrikrad + 1)) {
    const rad = tolkaRad(falt, kolumner);
    if (rad !== undefined) {
      transaktioner.push(rad);
    }
  }

  if (transaktioner.length === 0) {
    throw new OlasbartKontoutdragError('filen innehåller inga transaktioner.');
  }

  // Oldest first, which is the order a ledger is read in. Banks export both.
  return transaktioner.sort((a, b) =>
    a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0,
  );
}

interface Kolumner {
  readonly datum: number;
  readonly text: number;
  readonly belopp: number;
  readonly saldo?: number;
}

function hittarKolumner(falt: readonly string[]): Kolumner | undefined {
  /*
   * Searched in the order the names are listed, not the order the columns
   * happen to appear in: the list is a preference, and a file carrying both
   * spellings should give the better one.
   */
  const hitta = (namn: readonly string[]) => {
    for (const kandidat of namn) {
      const index = falt.findIndex((rubrik) => normalisera(rubrik) === kandidat);
      if (index !== -1) {
        return index;
      }
    }
    return -1;
  };

  const datumkolumn = hitta(KOLUMNER.datum);
  const textkolumn = hitta(KOLUMNER.text);
  const beloppskolumn = hitta(KOLUMNER.belopp);
  if (datumkolumn === -1 || textkolumn === -1 || beloppskolumn === -1) {
    return undefined;
  }

  const saldokolumn = hitta(KOLUMNER.saldo);
  return {
    datum: datumkolumn,
    text: textkolumn,
    belopp: beloppskolumn,
    ...(saldokolumn === -1 ? {} : { saldo: saldokolumn }),
  };
}

function tolkaRad(
  falt: readonly string[],
  kolumner: Kolumner,
): Banktransaktion | undefined {
  const datumtext = falt[kolumner.datum]?.trim() ?? '';
  const beloppstext = falt[kolumner.belopp]?.trim() ?? '';
  if (datumtext.length === 0 || beloppstext.length === 0) {
    // A blank line, or the summary row banks like to put at the end.
    return undefined;
  }

  const dag = tolkaDatum(datumtext);
  const belopp = tolkaBelopp(beloppstext);
  if (dag === undefined || belopp === undefined) {
    return undefined;
  }

  const saldo =
    kolumner.saldo === undefined ? undefined : tolkaBelopp(falt[kolumner.saldo] ?? '');

  return {
    datum: dag,
    text: (falt[kolumner.text] ?? '').trim().replace(/\s+/g, ' '),
    belopp,
    ...(saldo === undefined ? {} : { saldo }),
  };
}

/**
 * A date as a bank writes it.
 *
 * ISO is what every Swedish bank exports, and the two-digit form still turns
 * up in older files. Anything else is left alone rather than guessed at: a
 * date read wrongly puts a transaction in the wrong month, and the wrong
 * month is the wrong momsdeklaration.
 */
function tolkaDatum(text: string): Datum | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    try {
      return datum(`${iso[1]}-${iso[2]}-${iso[3]}`);
    } catch {
      return undefined;
    }
  }

  const kort = /^(\d{2})(\d{2})(\d{2})$/.exec(text);
  if (kort) {
    try {
      return datumAv(2000 + Number(kort[1]), Number(kort[2]), Number(kort[3]));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * An amount as a bank writes it: -1 234,56 or 1234.56 or 1 234,56- .
 *
 * Parsed into whole öre digit by digit, never through a float (hard rule 1).
 */
function tolkaBelopp(text: string): Ore | undefined {
  const rensad = text
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/kr$/i, '')
    .replace(/^\+/, '');

  // Trailing minus, which some exports use instead of a leading one.
  const negativ = rensad.startsWith('-') || rensad.endsWith('-');
  const siffror = rensad.replace(/-/g, '');

  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(siffror);
  if (!match) {
    return undefined;
  }

  const heltal = match[1] ?? '0';
  const decimaler = (match[2] ?? '').padEnd(2, '0');
  const belopp = Number(`${heltal}${decimaler}`);
  if (!Number.isSafeInteger(belopp)) {
    return undefined;
  }
  return ore(negativ ? -belopp : belopp);
}

/**
 * Which separator the file uses.
 *
 * Decided by counting on the first lines rather than by trusting a setting.
 * Semicolon is what a Swedish bank exports, because the decimal comma has
 * already taken the comma - but a file that has been through a spreadsheet
 * in another locale comes back with commas, and it is still the same file.
 */
function hittaAvgransare(rader: readonly string[]): string {
  const prov = rader.slice(0, 10);
  let bast = ';';
  let flest = -1;
  for (const kandidat of [';', '\t', ',']) {
    const antal = prov.reduce(
      (summa, rad) => summa + delaFalt(rad, kandidat).length - 1,
      0,
    );
    if (antal > flest) {
      flest = antal;
      bast = kandidat;
    }
  }
  return bast;
}

/** Splits on newlines, keeping quoted fields that contain one together. */
function delaRader(text: string): string[] {
  const rader: string[] = [];
  let aktuell = '';
  let iCitat = false;

  for (let i = 0; i < text.length; i += 1) {
    const tecken = text[i];
    if (tecken === '"') {
      iCitat = !iCitat;
      aktuell += tecken;
    } else if ((tecken === '\n' || tecken === '\r') && !iCitat) {
      if (tecken === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      if (aktuell.trim().length > 0) {
        rader.push(aktuell);
      }
      aktuell = '';
    } else {
      aktuell += tecken;
    }
  }

  if (aktuell.trim().length > 0) {
    rader.push(aktuell);
  }
  return rader;
}

/** One line into fields, honouring quotes and doubled quotes inside them. */
function delaFalt(rad: string, avgransare: string): string[] {
  const falt: string[] = [];
  let aktuellt = '';
  let iCitat = false;

  for (let i = 0; i < rad.length; i += 1) {
    const tecken = rad[i];
    if (iCitat) {
      if (tecken === '"') {
        if (rad[i + 1] === '"') {
          aktuellt += '"';
          i += 1;
        } else {
          iCitat = false;
        }
      } else {
        aktuellt += tecken;
      }
    } else if (tecken === '"') {
      iCitat = true;
    } else if (tecken === avgransare) {
      falt.push(aktuellt);
      aktuellt = '';
    } else {
      aktuellt += tecken;
    }
  }

  falt.push(aktuellt);
  return falt;
}

function normalisera(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}
