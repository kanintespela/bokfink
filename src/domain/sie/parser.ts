import { oreFromKronor, type Ore } from '../belopp/ore';
import { datum, type Datum } from '../tid/datum';
import { laseSie, type Siepost } from './lexer';

export interface Sierakenskapsar {
  /** 0 is the year the file is about, -1 the one before it. */
  readonly index: number;
  readonly start: Datum;
  readonly slut: Datum;
}

export interface Siekonto {
  readonly nummer: string;
  readonly namn: string;
  /** #KTYP, when the file says: T tillgång, S skuld, K kostnad, I intäkt. */
  readonly typ?: 'T' | 'S' | 'K' | 'I';
  /** An account may map to several SRU codes. */
  readonly sru: readonly string[];
}

export interface Siesaldo {
  readonly arsindex: number;
  readonly konto: string;
  readonly belopp: Ore;
}

export interface Sietransaktion {
  readonly konto: string;
  readonly belopp: Ore;
  readonly datum?: Datum;
  readonly text?: string;
}

export interface Sieverifikat {
  readonly serie: string;
  readonly nummer: string;
  readonly datum: Datum;
  readonly text: string;
  readonly registrerad?: Datum;
  readonly transaktioner: readonly Sietransaktion[];
}

export interface Siedokument {
  readonly sietyp: number;
  readonly format: string;
  readonly orgnr?: string;
  readonly foretagsnamn?: string;
  readonly valuta?: string;
  readonly rakenskapsar: readonly Sierakenskapsar[];
  readonly konton: readonly Siekonto[];
  readonly ingaende: readonly Siesaldo[];
  readonly utgaende: readonly Siesaldo[];
  readonly resultat: readonly Siesaldo[];
  readonly verifikat: readonly Sieverifikat[];
  /** Labels the reader knows nothing about, kept so nothing is lost silently. */
  readonly okandaEtiketter: readonly string[];
}

export class SieError extends Error {
  constructor(rad: number, orsak: string) {
    super(`Rad ${rad} i SIE-filen: ${orsak}`);
    this.name = 'SieError';
  }
}

const KANDA = new Set([
  'FLAGGA',
  'PROGRAM',
  'FORMAT',
  'GEN',
  'SIETYP',
  'PROSA',
  'FNR',
  'ORGNR',
  'ADRESS',
  'FNAMN',
  'RAR',
  'TAXAR',
  'OMFATTN',
  'KPTYP',
  'VALUTA',
  'KONTO',
  'KTYP',
  'ENHET',
  'SRU',
  'DIM',
  'UNDERDIM',
  'OBJEKT',
  'IB',
  'UB',
  'OIB',
  'OUB',
  'RES',
  'PSALDO',
  'PBUDGET',
  'VER',
  'TRANS',
  'BTRANS',
  'RTRANS',
]);

/**
 * Reads a decoded SIE file into the shape the importer works from.
 *
 * Structure only. Whether a verifikat balances, whether an account may carry
 * an opening balance and whether a date falls in an open period are questions
 * the ledger answers when the data is booked, so they are asked once there
 * rather than twice.
 */
export function tolkaSie(text: string): Siedokument {
  const poster = laseSie(text);

  let sietyp: number | undefined;
  let format: string | undefined;
  let orgnr: string | undefined;
  let foretagsnamn: string | undefined;
  let valuta: string | undefined;

  const rakenskapsar: Sierakenskapsar[] = [];
  const kontonamn = new Map<string, string>();
  const kontotyper = new Map<string, 'T' | 'S' | 'K' | 'I'>();
  const sruKoder = new Map<string, string[]>();
  const ingaende: Siesaldo[] = [];
  const utgaende: Siesaldo[] = [];
  const resultat: Siesaldo[] = [];
  const verifikat: Sieverifikat[] = [];
  const okanda = new Set<string>();

  let oppet: { post: Sieverifikat; transaktioner: Sietransaktion[] } | undefined;

  for (const post of poster) {
    const { etikett, falt, rad } = post;

    if (!KANDA.has(etikett)) {
      okanda.add(etikett);
      continue;
    }

    // A #TRANS belongs to whichever #VER last opened; anything else closes it.
    if (etikett !== 'TRANS' && etikett !== 'BTRANS' && etikett !== 'RTRANS') {
      oppet = undefined;
    }

    switch (etikett) {
      case 'SIETYP':
        sietyp = Number(kravFalt(post, 0, 'SIE-typ'));
        break;
      case 'FORMAT':
        format = kravFalt(post, 0, 'teckenuppsättning');
        break;
      case 'ORGNR':
        orgnr = falt[0];
        break;
      case 'FNAMN':
        foretagsnamn = falt[0];
        break;
      case 'VALUTA':
        valuta = falt[0];
        break;

      case 'RAR':
        rakenskapsar.push({
          index: Number(kravFalt(post, 0, 'årsindex')),
          start: sieDatum(kravFalt(post, 1, 'startdatum'), rad),
          slut: sieDatum(kravFalt(post, 2, 'slutdatum'), rad),
        });
        break;

      case 'KONTO':
        kontonamn.set(kravFalt(post, 0, 'kontonummer'), kravFalt(post, 1, 'kontonamn'));
        break;

      case 'KTYP': {
        const typ = kravFalt(post, 1, 'kontotyp').toUpperCase();
        if (typ !== 'T' && typ !== 'S' && typ !== 'K' && typ !== 'I') {
          throw new SieError(
            rad,
            `"${typ}" är inte en kontotyp. Väntade T, S, K eller I.`,
          );
        }
        kontotyper.set(kravFalt(post, 0, 'kontonummer'), typ);
        break;
      }

      case 'SRU': {
        const konto = kravFalt(post, 0, 'kontonummer');
        const koder = sruKoder.get(konto) ?? [];
        koder.push(kravFalt(post, 1, 'SRU-kod'));
        sruKoder.set(konto, koder);
        break;
      }

      case 'IB':
        ingaende.push(saldo(post));
        break;
      case 'UB':
        utgaende.push(saldo(post));
        break;
      case 'RES':
        resultat.push(saldo(post));
        break;

      case 'VER': {
        const transaktioner: Sietransaktion[] = [];
        const registrerad = falt[4];
        const post_: Sieverifikat = {
          serie: kravFalt(post, 0, 'verifikatserie'),
          nummer: kravFalt(post, 1, 'verifikationsnummer'),
          datum: sieDatum(kravFalt(post, 2, 'verifikatdatum'), rad),
          text: falt[3] ?? '',
          ...(registrerad === undefined || registrerad === ''
            ? {}
            : { registrerad: sieDatum(registrerad, rad) }),
          transaktioner,
        };
        verifikat.push(post_);
        oppet = { post: post_, transaktioner };
        break;
      }

      case 'TRANS': {
        if (oppet === undefined) {
          throw new SieError(rad, 'en #TRANS står utanför något verifikat.');
        }
        const transdatum = falt[3];
        const transtext = falt[4];
        oppet.transaktioner.push({
          konto: kravFalt(post, 0, 'kontonummer'),
          // Field 1 is the dimension list, which this program does not use yet.
          belopp: belopp(kravFalt(post, 2, 'belopp'), rad),
          ...(transdatum === undefined || transdatum === ''
            ? {}
            : { datum: sieDatum(transdatum, rad) }),
          ...(transtext === undefined || transtext === '' ? {} : { text: transtext }),
        });
        break;
      }

      default:
        // Known but unused: #FLAGGA, #PROGRAM, #GEN, #ADRESS, dimensions.
        break;
    }
  }

  if (sietyp === undefined) {
    throw new SieError(0, 'filen saknar #SIETYP och går inte att tolka.');
  }
  if (sietyp !== 4) {
    throw new SieError(
      0,
      `filen är av SIE-typ ${sietyp}. Kontera läser typ 4, som är den enda som ` +
        'innehåller verifikationer.',
    );
  }
  if (format !== undefined && format.toUpperCase() !== 'PC8') {
    throw new SieError(
      0,
      `filen anger teckenuppsättningen ${format}, men SIE-formatet definierar ` +
        'bara PC8. Innehållet kan ha lästs fel.',
    );
  }

  const konton: Siekonto[] = [...kontonamn.entries()].map(([nummer, namn]) => {
    const typ = kontotyper.get(nummer);
    return {
      nummer,
      namn,
      ...(typ === undefined ? {} : { typ }),
      sru: sruKoder.get(nummer) ?? [],
    };
  });

  return {
    sietyp,
    format: format ?? 'PC8',
    ...(orgnr === undefined ? {} : { orgnr }),
    ...(foretagsnamn === undefined ? {} : { foretagsnamn }),
    ...(valuta === undefined ? {} : { valuta }),
    rakenskapsar,
    konton,
    ingaende,
    utgaende,
    resultat,
    verifikat,
    okandaEtiketter: [...okanda].sort(),
  };
}

function kravFalt(post: Siepost, index: number, vad: string): string {
  const varde = post.falt[index];
  if (varde === undefined) {
    throw new SieError(post.rad, `#${post.etikett} saknar ${vad}.`);
  }
  return varde;
}

function saldo(post: Siepost): Siesaldo {
  return {
    arsindex: Number(kravFalt(post, 0, 'årsindex')),
    konto: kravFalt(post, 1, 'kontonummer'),
    belopp: belopp(kravFalt(post, 2, 'belopp'), post.rad),
  };
}

function belopp(text: string, rad: number): Ore {
  try {
    return oreFromKronor(text);
  } catch (orsak) {
    throw new SieError(rad, orsak instanceof Error ? orsak.message : String(orsak));
  }
}

/** SIE writes dates as YYYYMMDD; the domain wants YYYY-MM-DD. */
function sieDatum(text: string, rad: number): Datum {
  if (!/^\d{8}$/.test(text)) {
    throw new SieError(rad, `"${text}" är inte ett datum på formen ÅÅÅÅMMDD.`);
  }
  try {
    return datum(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`);
  } catch (orsak) {
    throw new SieError(rad, orsak instanceof Error ? orsak.message : String(orsak));
  }
}
