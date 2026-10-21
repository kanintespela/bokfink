import { kronorString, type Ore } from '../belopp/ore';
import { delar, type Datum } from '../tid/datum';
import type { Momsrapport } from './momsrapport';

/**
 * The XML element each box is written as in an eSKD file.
 *
 * Two sources, and the difference between them matters.
 *
 * Boxes 05-12, 48 and 49 are taken from Skatteverket's own description of the
 * file format at "Lämna momsdeklaration via fil i e-tjänsten".
 *
 * The rest come from Microsoft's documentation of the Dynamics 365 electronic
 * reporting format for the Swedish VAT return, which maps every box to its
 * element. That is second-hand, and it is trusted here for one reason: it
 * agrees with Skatteverket's own list on all nine names that appear in both.
 * A wrong name would also fail safe - the DTD rejects an element it does not
 * know, so the upload is refused rather than a wrong figure filed.
 *
 * The DTD itself is no longer downloadable. The URL the DOCTYPE names, which
 * every generator still writes, returns 404; the public identifier is what
 * validation matches on.
 *
 * "Eg" in several names is Europeiska gemenskapen, the term in use when the
 * format was written. It is the element name, not a typo.
 */
const ELEMENT: ReadonlyMap<number, string> = new Map([
  // A. Momspliktig försäljning eller uttag.
  [5, 'ForsMomsEjAnnan'],
  [6, 'UttagMoms'],
  [7, 'UlagMargbesk'],
  [8, 'HyrinkomstFriv'],

  // B. Utgående moms på egen försäljning.
  [10, 'MomsUtgHog'],
  [11, 'MomsUtgMedel'],
  [12, 'MomsUtgLag'],

  // C. Momspliktiga inköp där köparen är skattskyldig.
  [20, 'InkopVaruAnnatEg'],
  [21, 'InkopTjanstAnnatEg'],
  [22, 'InkopTjanstUtomEg'],
  [23, 'InkopVaruSverige'],
  [24, 'InkopTjanstSverige'],

  // D. Utgående moms på de inköpen.
  [30, 'MomsInkopUtgHog'],
  [31, 'MomsInkopUtgMedel'],
  [32, 'MomsInkopUtgLag'],

  // E. Försäljning undantagen från moms.
  [35, 'ForsVaruAnnatEg'],
  [36, 'ForsVaruUtomEg'],
  [37, 'InkopVaruMellan3p'],
  [38, 'ForsVaruMellan3p'],
  [39, 'ForsTjSkskAnnatEg'],
  [40, 'ForsTjOvrUtomEg'],
  [41, 'ForsKopareSkskSverige'],
  [42, 'ForsOvrigt'],

  // F och G. Import och utgående moms på import.
  [50, 'MomsUlagImport'],
  [60, 'MomsImportUtgHog'],
  [61, 'MomsImportUtgMedel'],
  [62, 'MomsImportUtgLag'],

  // H och I. Ingående moms och summan.
  [48, 'MomsIngAvdr'],
  [49, 'MomsBetala'],
]);

/**
 * Raised when a box has a figure and no element name is known for it.
 *
 * Every box the declaration has is now mapped, so this should never happen -
 * but the guard stays. If the form ever gains a box, refusing by name is a
 * better answer than writing a tag nobody chose.
 */
export class OkandRutaError extends Error {
  constructor(readonly rutor: readonly number[]) {
    super(
      `Kontera kan inte skriva en eSKD-fil som innehåller ruta ` +
        `${rutor.join(', ')}: elementnamnet är okänt, och en gissning ger ` +
        'antingen en avvisad fil eller en inlämnad felaktig siffra. Redovisa ' +
        'den perioden i e-tjänsten i stället.',
    );
    this.name = 'OkandRutaError';
  }
}

/**
 * Box 49, the sum the whole return exists to state.
 *
 * It is written even when it is zero, unlike every other box. An empty box
 * means "nothing here"; a zero in box 49 means "nothing to pay", and those are
 * different statements. A period where output and input VAT cancel exactly,
 * and a period with no activity at all, still have to say what is owed - that
 * is what a nolldeklaration is.
 */
const SUMMARUTA = 49;

export interface Eskduppgifter {
  readonly organisationsnummer: string;
  readonly rapport: Momsrapport;
  /** Free text to Skatteverket, at most 300 characters. */
  readonly upplysning?: string;
}

/**
 * Writes the momsdeklaration as an eSKD file.
 *
 * Amounts are whole kronor without decimals, which is what the return states
 * anyway - the boxes were already truncated when the report was calculated,
 * so nothing is rounded a second time here.
 */
export function skrivEskd(uppgifter: Eskduppgifter): string {
  const { rapport } = uppgifter;

  const okanda = rapport.rader
    .filter((rad) => rad.belopp !== 0 && !ELEMENT.has(rad.ruta.nummer))
    .map((rad) => rad.ruta.nummer);
  if (okanda.length > 0) {
    throw new OkandRutaError(okanda);
  }

  const rader = [
    '<?xml version="1.0" encoding="ISO-8859-1"?>',
    '<!DOCTYPE eSKDUpload PUBLIC "-//Skatteverket, Sweden//DTD Skatteverket eSKDUpload-DTD Version 6.0//SV" "https://www1.skatteverket.se/demoeskd/eSKDUpload_6p0.dtd">',
    '<eSKDUpload Version="6.0">',
    `  <OrgNr>${organisationsnummer(uppgifter.organisationsnummer)}</OrgNr>`,
    '  <Moms>',
    `    <Period>${period(rapport.till)}</Period>`,
  ];

  for (const rad of rapport.rader) {
    const namn = ELEMENT.get(rad.ruta.nummer);
    if (namn === undefined) {
      continue;
    }
    if (rad.belopp === 0 && rad.ruta.nummer !== SUMMARUTA) {
      continue;
    }
    rader.push(`    <${namn}>${heltKrontal(rad.belopp)}</${namn}>`);
  }

  if (uppgifter.upplysning !== undefined && uppgifter.upplysning.trim().length > 0) {
    rader.push(
      `    <TextUpplysningMoms>${xml(uppgifter.upplysning.slice(0, 300))}</TextUpplysningMoms>`,
    );
  }

  rader.push('  </Moms>', '</eSKDUpload>', '');
  return rader.join('\n');
}

/**
 * A quarterly return is filed for the last month of the quarter.
 *
 * Confirmed against real filings: the automatic transfers in the books being
 * migrated name their periods 202503, 202506, 202509 and 202512.
 */
function period(till: Datum): string {
  const { ar, manad } = delar(till);
  return `${ar}${String(manad).padStart(2, '0')}`;
}

function organisationsnummer(nummer: string): string {
  const alla = nummer.replace(/\D/g, '');
  /*
   * A personnummer written with its century, as the NE-bilaga asks for it.
   * The file wants ten digits, and 16, 19 and 20 are the only prefixes the
   * twelve-digit form uses; anything else is a typing error, not a century.
   */
  const siffror = /^(16|19|20)\d{10}$/.test(alla) ? alla.slice(2) : alla;
  if (siffror.length !== 10) {
    throw new TypeError(
      `Organisationsnumret måste ha tio siffror, eller tolv med sekelsiffror, fick ` +
        `"${nummer}". För enskild firma är det innehavarens personnummer. Fyll i det ` +
        'under Inställningar, Företaget.',
    );
  }
  return `${siffror.slice(0, 6)}-${siffror.slice(6)}`;
}

/** Whole kronor with no decimals, which is what the file carries. */
function heltKrontal(belopp: Ore): string {
  return kronorString(belopp).replace(/\.00$/, '');
}

function xml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
