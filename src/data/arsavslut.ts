import { nastaRakenskapsarsperiod } from '../domain/bokslut/arsavslut';
import { isZero } from '../domain/belopp/ore';
import {
  arEgetKapitalomforing,
  omforingAvEgetKapitalUnderkonton,
} from '../domain/bokslut/egetkapital';
import {
  FramtidaDatumError,
  omfattar,
  rakenskapsarsid,
  skapaRakenskapsar,
  type Ingaendebalans,
  type Rakenskapsar,
} from '../domain/rakenskapsar/rakenskapsar';
import { beraknaSaldon, utgaendeBalanser } from '../domain/rapport/saldon';
import { dagarMellan, datum, type Datum } from '../domain/tid/datum';
import type { Verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast, type BokfortVerifikat } from '../domain/verifikat/verifikat';
import { lasTillstand, tillampa } from './bokforing';
import type { KonteraDatabase } from './db';
import {
  bokforUtkast,
  huvud,
  nyttId,
  sattIngaendeBalanser,
  type Skrivkontext,
} from './kommandon';

/**
 * Creates the year right after `ar`, with no ingående balanser yet, unless
 * it already exists - in which case the existing one is returned untouched.
 * Idempotent so a checklist screen can offer this step freely without
 * worrying about calling it twice.
 */
export async function skapaNastaRakenskapsar(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  ar: Rakenskapsar,
): Promise<Rakenskapsar> {
  const { start, slut } = nastaRakenskapsarsperiod(ar);
  const tillstand = await lasTillstand(db);
  const befintligt = [...tillstand.rakenskapsar.values()].find(
    (kandidat) => kandidat.start === start,
  );
  if (befintligt !== undefined) {
    return befintligt;
  }

  // The identifier comes from the start date, as in uppstart.ts: two devices
  // that each create next year have to arrive at one year, not two.
  const nytt = skapaRakenskapsar({ id: rakenskapsarsid(start), start, slut });
  await tillampa(db, {
    ...huvud(kontext),
    typ: 'rakenskapsar.skapat',
    rakenskapsar: nytt,
  });
  return nytt;
}

export interface Arsavslutschecklista {
  readonly obokfordaUtkast: number;
  readonly momsTackerHelaAret: boolean;
  readonly djurlagerInventeratIAr: boolean;
  readonly nastaAr: Rakenskapsar | undefined;
  /** Undefined when no backup has ever been taken on this device. */
  readonly dagarSedanBackup: number | undefined;
}

/**
 * What to check before closing a year. Two items are yes/no because they are
 * mechanically checkable; avskrivningar and periodiseringar are not listed
 * here at all - whether they are needed and whether they are done is a
 * judgement call (hård regel 10), not something to fake a checkmark for.
 */
export async function arsavslutschecklista(
  db: KonteraDatabase,
  ar: Rakenskapsar,
  idag: Datum,
): Promise<Arsavslutschecklista> {
  const tillstand = await lasTillstand(db);
  const backupSenast = await db.getMeta<string>('backup.senast');

  const obokfordaUtkast = [...tillstand.utkast.values()].filter((utkast) =>
    omfattar(ar, utkast.datum),
  ).length;

  const djurlagerInventeratIAr = [...tillstand.djurlagerinventeringar.values()].some(
    (inventering) => omfattar(ar, inventering.datum),
  );

  const nastaArsStart = nastaRakenskapsarsperiod(ar).start;
  const nastaAr = [...tillstand.rakenskapsar.values()].find(
    (kandidat) => kandidat.start === nastaArsStart,
  );

  return {
    obokfordaUtkast,
    momsTackerHelaAret: ar.momslastTom !== undefined && ar.momslastTom >= ar.slut,
    djurlagerInventeratIAr,
    nastaAr,
    dagarSedanBackup:
      backupSenast === undefined ? undefined : dagarMellan(datum(backupSenast), idag),
  };
}

export interface Balansoverforing {
  readonly balanser: readonly Ingaendebalans[];
  /**
   * The verifikat that folds 2011-2019 into 2010, when there was anything to
   * fold and it could be dated. Undefined either because no underkonto had a
   * balance, or because the new year's first day has not arrived yet -
   * beslut P forbids a future-dated verifikat, and the button can be
   * pressed again once it has, since the amount is worked out fresh each
   * time.
   */
  readonly omforing: BokfortVerifikat | undefined;
}

/**
 * Reads the year's booked verifikat, computes closing balances for every
 * balance-sheet account, and sets them as `nastaAr`'s ingående balanser.
 *
 * Also books the omföring other bookkeeping programs follow too (beslut
 * 2026-09-13): 2011-2019's balances folded into 2010 on the new year's
 * first day, so uttag, insättningar, skattekontot and the year's result
 * start every year at zero instead of piling up on their own accounts. See
 * {@link omforingAvEgetKapitalUnderkonton}.
 *
 * Does not close `ar` - that is {@link avslutaRakenskapsar}'s job, kept
 * separate so the transfer can be reviewed before the year is locked for
 * good.
 */
export async function forUtgaendeBalanserTillNastaAr(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  ar: Rakenskapsar,
  nastaArId: Rakenskapsar['id'],
  serie: Verifikatserie,
): Promise<Balansoverforing> {
  const tillstand = await lasTillstand(db);
  const iAret = [...tillstand.verifikat.values()].filter((v) => omfattar(ar, v.datum));
  const saldon = beraknaSaldon(ar.ingaendeBalanser, iAret);
  const balanser = utgaendeBalanser(saldon)
    .filter((saldo) => !isZero(saldo.utgaende))
    .map((saldo) => ({ konto: saldo.konto, belopp: saldo.utgaende }));

  await sattIngaendeBalanser(db, kontext, nastaArId, balanser);

  const konteringar = omforingAvEgetKapitalUnderkonton(balanser);
  const nastaArsStart = nastaRakenskapsarsperiod(ar).start;
  const befintlig = [...tillstand.verifikat.values()].find(
    (v) => v.datum === nastaArsStart && arEgetKapitalomforing(v.konteringar),
  );
  if (konteringar.length === 0) {
    return { balanser, omforing: undefined };
  }
  if (befintlig !== undefined) {
    return { balanser, omforing: befintlig };
  }

  try {
    const omforing = await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: nyttId(kontext),
        datum: nastaArsStart,
        beskrivning: 'Omföring av eget kapital',
        konteringar,
      }),
      serie,
    );
    return { balanser, omforing };
  } catch (orsak) {
    // Balanserna är ändå förda över; omföringen görs nästa gång knappen
    // trycks, sedan årsskiftet faktiskt kommit - se kontrolleraInteFramtida,
    // beslut P.
    if (orsak instanceof FramtidaDatumError) {
      return { balanser, omforing: undefined };
    }
    throw orsak;
  }
}
