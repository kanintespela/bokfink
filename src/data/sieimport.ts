import { avkodaPC8 } from '../domain/sie/pc8';
import { tolkaSie, type Siedokument, type Siekonto } from '../domain/sie/parser';
import {
  harledKontotyp,
  kontonummer,
  skapaKonto,
  type Kontotyp,
} from '../domain/konto/konto';
import {
  skapaRakenskapsar,
  type Ingaendebalans,
  rakenskapsarsid,
} from '../domain/rakenskapsar/rakenskapsar';
import { jamfor, type Datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { bokfor, skapaUtkast, type Kontering } from '../domain/verifikat/verifikat';
import type { Rakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import type { Uuid } from '../domain/id/uuidv7';
import { tillampa, type VerifikatRad } from './bokforing';
import type { KonteraDatabase } from './db';
import { newIdentifier } from './id';
import {
  avslutaRakenskapsar,
  sattIngaendeBalanser,
  skrivKonto,
  skrivRakenskapsar,
  type Skrivkontext,
} from './kommandon';
import { RAKENSKAPSAR_TABLE, VERIFIKAT_TABLE } from './schema';

export interface Importresultat {
  readonly rakenskapsar: number;
  readonly konton: number;
  readonly verifikat: number;
  /** Verifikat already present, counted rather than duplicated. */
  readonly redanImporterade: number;
  readonly avslutadeAr: number;
  readonly varningar: readonly string[];
}

export interface Importinstallningar {
  /**
   * Close every fiscal year ending on or before this date.
   *
   * A closed year cannot be booked into, which is what protects history whose
   * momsdeklaration has already been filed from being changed by accident.
   */
  readonly avslutaTomOchMed?: Datum;
}

/** SIE's four account types mapped onto Kontera's five. */
const FRAN_SIE: Record<'T' | 'S' | 'K' | 'I', Kontotyp | undefined> = {
  T: 'tillgang',
  // S covers both equity and debt, so the number decides which.
  S: undefined,
  K: 'kostnad',
  I: 'intakt',
};

/**
 * Reads SIE files into the ledger.
 *
 * Files are taken in the order their fiscal year starts, so a year exists
 * before anything is booked into it. Each file contributes only its own year
 * - its #RAR 0 - because a multi-year import would otherwise create every
 * year twice, once as current and once as the previous year of the next file.
 *
 * Verification numbers come from the file and are kept. Renumbering imported
 * history would break the unbroken series the law requires and make the books
 * disagree with the ones they were exported from.
 */
export async function importeraSieFiler(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  filer: readonly Uint8Array[],
  installningar: Importinstallningar = {},
): Promise<Importresultat> {
  const dokument = filer.map((bytes) => tolkaSie(avkodaPC8(bytes)));
  const varningar: string[] = [];

  const iOrdning = [...dokument].sort((a, b) =>
    jamfor(aktuelltAr(a).start, aktuelltAr(b).start),
  );

  let nyaAr = 0;
  let nyaKonton = 0;
  let nyaVerifikat = 0;
  let redanImporterade = 0;

  for (const doc of iOrdning) {
    const ar = aktuelltAr(doc);

    const befintligt = await hittaArMedStart(db, ar.start);
    let arId: Uuid;

    if (befintligt === undefined) {
      // Same reasoning as in uppstart.ts: two devices importing the same SIE
      // file must arrive at one year, not two.
      arId = rakenskapsarsid(ar.start);
      await skrivRakenskapsar(
        db,
        kontext,
        skapaRakenskapsar({
          id: arId,
          start: ar.start,
          slut: ar.slut,
          ingaendeBalanser: ingaendeBalanser(doc, varningar),
        }),
      );
      nyaAr += 1;
    } else {
      arId = befintligt.id;

      /*
       * The year may already exist because the app created it at first start,
       * empty. Filling in the balances the file carries is the difference
       * between an import that lands complete and one that quietly starts
       * every account at zero.
       *
       * Balances already there are left alone and reported instead. They came
       * from somewhere, and overwriting them on the strength of a file
       * someone happened to pick is not a decision an importer gets to make.
       */
      const franFilen = ingaendeBalanser(doc, varningar);
      if (befintligt.ingaendeBalanser.length === 0) {
        if (franFilen.length > 0) {
          await sattIngaendeBalanser(db, kontext, arId, franFilen);
        }
      } else if (skiljerSig(befintligt.ingaendeBalanser, franFilen)) {
        varningar.push(
          `Räkenskapsåret ${befintligt.start}–${befintligt.slut} har redan ingående ` +
            'balanser som skiljer sig från filens. Filens lämnades utan åtgärd.',
        );
      }
    }

    for (const konto of doc.konton) {
      const skapat = await skrivOmNytt(db, kontext, konto);
      if (skapat) {
        nyaKonton += 1;
      }
    }

    for (const ver of doc.verifikat) {
      const serie = verifikatserie(ver.serie);
      const nummer = Number(ver.nummer);
      if (!Number.isInteger(nummer) || nummer < 1) {
        throw new Error(
          `Verifikat ${ver.serie}${ver.nummer} har inget giltigt verifikationsnummer.`,
        );
      }

      if (await finnsRedan(db, arId, serie, nummer)) {
        redanImporterade += 1;
        continue;
      }

      const konteringar: Kontering[] = ver.transaktioner.map((trans) => ({
        konto: kontonummer(trans.konto),
        belopp: trans.belopp,
        ...(trans.text === undefined ? {} : { text: trans.text }),
      }));

      const verifikat = bokfor(
        skapaUtkast({
          id: (kontext.nyttId ?? newIdentifier)(),
          datum: ver.datum,
          beskrivning: ver.text,
          konteringar,
        }),
        {
          serie,
          nummer,
          bokfortDatum: ver.registrerad ?? ver.datum,
          kalla: 'sie-import',
        },
      );

      await tillampa(db, {
        id: (kontext.nyttId ?? newIdentifier)(),
        enhet: kontext.enhet,
        tidpunkt: kontext.nu(),
        typ: 'verifikat.bokfort',
        verifikat,
      });
      nyaVerifikat += 1;
    }
  }

  const avslutadeAr = await avslutaTidigareAr(
    db,
    kontext,
    installningar.avslutaTomOchMed,
  );

  return {
    rakenskapsar: nyaAr,
    konton: nyaKonton,
    verifikat: nyaVerifikat,
    redanImporterade,
    avslutadeAr,
    varningar,
  };
}

function skiljerSig(a: readonly Ingaendebalans[], b: readonly Ingaendebalans[]): boolean {
  if (a.length !== b.length) {
    return true;
  }
  const karta = new Map(a.map((post) => [post.konto, post.belopp]));
  return b.some((post) => karta.get(post.konto) !== post.belopp);
}

function aktuelltAr(doc: Siedokument): { start: Datum; slut: Datum } {
  const ar = doc.rakenskapsar.find((kandidat) => kandidat.index === 0);
  if (ar === undefined) {
    throw new Error(
      'SIE-filen saknar #RAR 0 och säger därför inte vilket år den gäller.',
    );
  }
  return ar;
}

function ingaendeBalanser(doc: Siedokument, varningar: string[]): Ingaendebalans[] {
  const balanser: Ingaendebalans[] = [];
  for (const post of doc.ingaende.filter((p) => p.arsindex === 0)) {
    const konto = kontonummer(post.konto);
    const typ = harledKontotyp(konto);
    if (typ === undefined) {
      varningar.push(
        `Ingående balans på konto ${konto} hoppades över: kontoklass 8 rymmer ` +
          'både intäkter och kostnader, och ett resultatkonto bär ingen balans.',
      );
      continue;
    }
    balanser.push({ konto, belopp: post.belopp });
  }
  return balanser;
}

async function skrivOmNytt(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  konto: Siekonto,
): Promise<boolean> {
  const nummer = kontonummer(konto.nummer);
  const befintligt = await db.table('konto').get(nummer);
  if (befintligt !== undefined) {
    return false;
  }

  const franFil = konto.typ === undefined ? undefined : FRAN_SIE[konto.typ];
  const typ = franFil ?? harledKontotyp(nummer);
  if (typ === undefined) {
    throw new Error(
      `Kontot ${nummer} "${konto.namn}" har ingen kontotyp i filen, och klass 8 ` +
        'rymmer både finansiella intäkter och kostnader. Ange typen innan import.',
    );
  }

  await skrivKonto(
    db,
    kontext,
    skapaKonto({ nummer: konto.nummer, namn: konto.namn, typ, sru: konto.sru }),
  );
  return true;
}

async function hittaArMedStart(
  db: KonteraDatabase,
  start: Datum,
): Promise<Rakenskapsar | undefined> {
  return db
    .table<Rakenskapsar, Uuid>(RAKENSKAPSAR_TABLE)
    .where('start')
    .equals(start)
    .first();
}

async function finnsRedan(
  db: KonteraDatabase,
  rakenskapsarId: Uuid,
  serie: string,
  nummer: number,
): Promise<boolean> {
  const rad = await db
    .table<VerifikatRad, Uuid>(VERIFIKAT_TABLE)
    .where('[rakenskapsarId+serie+nummer]')
    .equals([rakenskapsarId, serie, nummer])
    .first();
  return rad !== undefined;
}

async function avslutaTidigareAr(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  tomOchMed: Datum | undefined,
): Promise<number> {
  if (tomOchMed === undefined) {
    return 0;
  }

  const alla = await db.table<Rakenskapsar, Uuid>(RAKENSKAPSAR_TABLE).toArray();
  let antal = 0;
  for (const ar of alla) {
    if (!ar.avslutat && jamfor(ar.slut, tomOchMed) <= 0) {
      await avslutaRakenskapsar(db, kontext, ar.id);
      antal += 1;
    }
  }
  return antal;
}
