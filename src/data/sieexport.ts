import { isZero } from '../domain/belopp/ore';
import { kodaPC8 } from '../domain/sie/pc8';
import type { Siedokument, Siekonto, Siesaldo, Sieverifikat } from '../domain/sie/parser';
import { skrivSie } from '../domain/sie/skrivare';
import {
  aretsResultatposter,
  beraknaSaldon,
  utgaendeBalanser,
} from '../domain/rapport/saldon';
import type { Konto, Kontotyp } from '../domain/konto/konto';
import { omfattar, type Rakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { jamfor } from '../domain/tid/datum';
import type { Uuid } from '../domain/id/uuidv7';
import type { BokfortVerifikat } from '../domain/verifikat/verifikat';
import { lasTillstand } from './bokforing';
import type { KonteraDatabase } from './db';

/** Kontera's five account types folded back into the four SIE has. */
const TILL_SIE: Record<Kontotyp, 'T' | 'S' | 'K' | 'I'> = {
  tillgang: 'T',
  egetKapital: 'S',
  skuld: 'S',
  intakt: 'I',
  kostnad: 'K',
};

export interface Exportinstallningar {
  readonly orgnr?: string;
  readonly foretagsnamn?: string;
}

/**
 * Builds the SIE document for one fiscal year.
 *
 * #UB and #RES are computed rather than stored, from the same function the
 * reports will use. An export that carried its own totals could drift from
 * the ledger it claims to describe, and nobody would find out until an
 * accountant did.
 */
export async function byggSiedokument(
  db: KonteraDatabase,
  rakenskapsarId: Uuid,
  installningar: Exportinstallningar = {},
): Promise<Siedokument> {
  const tillstand = await lasTillstand(db);

  const ar = tillstand.rakenskapsar.get(rakenskapsarId);
  if (ar === undefined) {
    throw new Error(
      `Det finns inget räkenskapsår med id ${rakenskapsarId} att exportera.`,
    );
  }

  const iAret = [...tillstand.verifikat.values()]
    .filter((verifikat) => omfattar(ar, verifikat.datum))
    .sort(efterSerieOchNummer);

  const saldon = beraknaSaldon(ar.ingaendeBalanser, iAret);
  const foregaende = tidigareAr(tillstand.rakenskapsar, ar);

  return {
    sietyp: 4,
    format: 'PC8',
    ...(installningar.orgnr === undefined ? {} : { orgnr: installningar.orgnr }),
    ...(installningar.foretagsnamn === undefined
      ? {}
      : { foretagsnamn: installningar.foretagsnamn }),
    valuta: 'SEK',
    rakenskapsar: [
      { index: 0, start: ar.start, slut: ar.slut },
      ...(foregaende === undefined
        ? []
        : [{ index: -1, start: foregaende.start, slut: foregaende.slut }]),
    ],
    konton: [...tillstand.konton.values()].sort(efterNummer).map(tillSiekonto),
    ingaende: ar.ingaendeBalanser.map((post): Siesaldo => ({
      arsindex: 0,
      konto: post.konto,
      belopp: post.belopp,
    })),
    /*
     * Accounts that end at nothing are left out, which is what every other
     * SIE writer does: an absent account reads as zero, so the row would add
     * noise without adding information.
     */
    utgaende: utgaendeBalanser(saldon)
      .filter((saldo) => !isZero(saldo.utgaende))
      .map((saldo): Siesaldo => ({
        arsindex: 0,
        konto: saldo.konto,
        belopp: saldo.utgaende,
      })),
    resultat: aretsResultatposter(saldon)
      .filter((saldo) => !isZero(saldo.forandring))
      .map((saldo): Siesaldo => ({
        arsindex: 0,
        konto: saldo.konto,
        belopp: saldo.forandring,
      })),
    verifikat: iAret.map(tillSieverifikat),
    okandaEtiketter: [],
  };
}

/** The finished file, as the bytes a SIE file actually contains. */
export async function exporteraSie(
  db: KonteraDatabase,
  rakenskapsarId: Uuid,
  installningar: Exportinstallningar = {},
): Promise<Uint8Array> {
  return kodaPC8(skrivSie(await byggSiedokument(db, rakenskapsarId, installningar)));
}

function tillSiekonto(konto: Konto): Siekonto {
  return {
    nummer: konto.nummer,
    namn: konto.namn,
    typ: TILL_SIE[konto.typ],
    sru: konto.sru,
  };
}

function tillSieverifikat(verifikat: BokfortVerifikat): Sieverifikat {
  return {
    serie: verifikat.serie,
    nummer: String(verifikat.nummer),
    datum: verifikat.datum,
    text: verifikat.beskrivning,
    registrerad: verifikat.bokfortDatum,
    transaktioner: verifikat.konteringar.map((rad) => ({
      konto: rad.konto,
      belopp: rad.belopp,
      ...(rad.text === undefined ? {} : { text: rad.text }),
    })),
  };
}

function tidigareAr(
  alla: ReadonlyMap<Uuid, Rakenskapsar>,
  ar: Rakenskapsar,
): Rakenskapsar | undefined {
  return [...alla.values()]
    .filter((kandidat) => jamfor(kandidat.slut, ar.start) < 0)
    .sort((a, b) => jamfor(b.slut, a.slut))[0];
}

function efterNummer(a: Konto, b: Konto): number {
  return a.nummer.localeCompare(b.nummer);
}

function efterSerieOchNummer(a: BokfortVerifikat, b: BokfortVerifikat): number {
  return a.serie === b.serie ? a.nummer - b.nummer : a.serie.localeCompare(b.serie);
}
