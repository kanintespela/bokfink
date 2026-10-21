import { kronorString, type Ore } from '../belopp/ore';
import type { Nebilaga } from '../skatt/nebilaga';
import { delar, type Datum } from '../tid/datum';

/**
 * INFO.SRU and BLANKETTER.SRU, the two files Skatteverket's filöverföring
 * takes for an NE-bilaga.
 *
 * The format is from Skatteverket's "Teknisk information om filöverföring"
 * and the SRU package for 2025P4: ISO 8859-1, one post per line starting
 * with #, values separated by a blank, negative amounts with a leading minus
 * and no leading zeros. INFO.SRU names the sender (the medieleverantör);
 * BLANKETTER.SRU holds one block per form, #BLANKETT to #BLANKETTSLUT, in
 * the order #BLANKETT, #IDENTITET, #NAMN, #UPPGIFT..., and ends with
 * #FIL_SLUT. Lines end in CR LF, which the description lists as the DOS
 * convention and which every system reading it accepts.
 */

/**
 * The beskattningsperioder whose NE fältnamnstabell Kontera has been checked
 * against, and the blankettblock name for each. A year missing from here is
 * refused rather than written with last year's codes: the form can change
 * between years, and a file that uploads with the wrong fields is worse than
 * one that does not upload at all.
 */
const KANDA_NE_BLOCK: Readonly<Record<string, string>> = {
  // NE_SKV2161-13-02-25-02, _Nyheter_from_beskattningsperiod_2025P4.zip
  '2025P4': 'NE-2025P4',
};

export interface Deklarant {
  /** Twelve digits, ÅÅÅÅMMDDNNNK - the owner's personnummer. */
  readonly personnummer: string;
  readonly namn: string;
  readonly adress?: string;
  readonly postnummer: string;
  readonly postort: string;
}

export interface Sruuppgifter {
  readonly deklarant: Deklarant;
  readonly rakenskapsar: { readonly start: Datum; readonly slut: Datum };
  /** Field 7020, optional. */
  readonly verksamhetensArt?: string;
  readonly ne: Nebilaga;
  /** When the files are made, injected so the output is reproducible. */
  readonly skapad: { readonly datum: Datum; readonly tid: string };
  readonly program: string;
}

export interface Srufiler {
  readonly info: string;
  readonly blanketter: string;
}

export class SruError extends Error {
  override readonly name = 'SruError';
}

/**
 * The beskattningsperiod for a fysisk person's NE: P4 of the calendar year
 * the räkenskapsår ends in. Only a räkenskapsår ending on 31 December is
 * handled; the SRU tables place a brutet år by the month it ends, and
 * Kontera has not been checked against that case.
 */
export function beskattningsperiod(slut: Datum): string {
  const { ar, manad, dag } = delar(slut);
  if (manad !== 12 || dag !== 31) {
    throw new SruError(
      'Kontera kan bara skriva NE-bilagan för ett räkenskapsår som slutar 31 december.',
    );
  }
  return `${ar}P4`;
}

export function skrivNeSru(uppgifter: Sruuppgifter): Srufiler {
  const { ne, deklarant } = uppgifter;
  if (ne.hinder.length > 0) {
    throw new SruError(`NE-bilagan kan inte lämnas ännu: ${ne.hinder.join(' ')}`);
  }

  const period = beskattningsperiod(uppgifter.rakenskapsar.slut);
  const block = KANDA_NE_BLOCK[period];
  if (block === undefined) {
    throw new SruError(
      `Kontera känner inte till NE-blanketten för ${period} ännu. Skatteverket ` +
        'publicerar fältkoderna inför varje deklarationsperiod.',
    );
  }

  const personnummer = kontrolleratPersonnummer(deklarant.personnummer);
  const namn = text(deklarant.namn, 'Namn');
  const postnummer = deklarant.postnummer.replace(/\s/g, '');
  if (!/^\d{5}$/.test(postnummer)) {
    throw new SruError(`Postnumret ska ha fem siffror, fick "${deklarant.postnummer}".`);
  }
  const postort = text(deklarant.postort, 'Postort');
  const skapad = `${kompakt(uppgifter.skapad.datum)} ${tid(uppgifter.skapad.tid)}`;

  const info = [
    '#DATABESKRIVNING_START',
    '#PRODUKT SRU',
    `#SKAPAD ${skapad}`,
    `#PROGRAM ${text(uppgifter.program, 'Program')}`,
    '#FILNAMN BLANKETTER.SRU',
    '#DATABESKRIVNING_SLUT',
    '#MEDIELEV_START',
    `#ORGNR ${personnummer}`,
    `#NAMN ${namn}`,
    ...(deklarant.adress?.trim() ? [`#ADRESS ${text(deklarant.adress, 'Adress')}`] : []),
    `#POSTNR ${postnummer}`,
    `#POSTORT ${postort}`,
    '#MEDIELEV_SLUT',
  ];

  const blanketter = [
    `#BLANKETT ${block}`,
    `#IDENTITET ${personnummer} ${skapad}`,
    `#NAMN ${namn}`,
    `#UPPGIFT 7011 ${kompakt(uppgifter.rakenskapsar.start)}`,
    `#UPPGIFT 7012 ${kompakt(uppgifter.rakenskapsar.slut)}`,
    ...(uppgifter.verksamhetensArt?.trim()
      ? [`#UPPGIFT 7020 ${text(uppgifter.verksamhetensArt, 'Verksamhetens art', 80)}`]
      : []),
    ...[...ne.sida1, ...ne.sida2].map(
      (rad) => `#UPPGIFT ${rad.faltkod} ${heltKrontal(rad.belopp)}`,
    ),
    '#BLANKETTSLUT',
    '#FIL_SLUT',
  ];

  return { info: rader(info), blanketter: rader(blanketter) };
}

/**
 * A personnummer as the file wants it: twelve digits, with the last ten
 * passing the Luhn check every Swedish personnummer carries. The century
 * cannot be recovered from ten digits, so it is asked for rather than
 * assumed.
 */
export function kontrolleratPersonnummer(nummer: string): string {
  const siffror = nummer.replace(/[\s-]/g, '');
  if (!/^\d{12}$/.test(siffror)) {
    throw new SruError(
      `Personnumret ska ha tolv siffror, ÅÅÅÅMMDDNNNK, fick "${nummer}".`,
    );
  }
  if (!luhn(siffror.slice(2))) {
    throw new SruError(`Personnumret ${nummer} har fel kontrollsiffra.`);
  }
  return siffror;
}

function luhn(tio: string): boolean {
  let summa = 0;
  for (let i = 0; i < tio.length; i += 1) {
    let siffra = Number(tio[i]) * (i % 2 === 0 ? 2 : 1);
    if (siffra > 9) {
      siffra -= 9;
    }
    summa += siffra;
  }
  return summa % 10 === 0;
}

/** Whole kronor, a leading minus when negative, no leading zeros. */
function heltKrontal(belopp: Ore): string {
  const text = kronorString(belopp);
  if (!text.endsWith('.00')) {
    throw new SruError(`Beloppet ${text} är inte i hela kronor.`);
  }
  return text.slice(0, -3);
}

function kompakt(datum: Datum): string {
  return datum.replaceAll('-', '');
}

function tid(text: string): string {
  if (!/^\d{6}$/.test(text)) {
    throw new SruError(`Klockslaget ska vara HHMMSS, fick "${text}".`);
  }
  return text;
}

/** One line of free text: no line breaks, not empty, within the field's length. */
function text(varde: string, falt: string, max = 250): string {
  const rensad = varde.replace(/\s+/g, ' ').trim();
  if (rensad === '') {
    throw new SruError(`${falt} får inte vara tomt.`);
  }
  if (rensad.length > max) {
    throw new SruError(`${falt} får vara högst ${max} tecken.`);
  }
  return rensad;
}

function rader(poster: readonly string[]): string {
  return poster.join('\r\n') + '\r\n';
}
