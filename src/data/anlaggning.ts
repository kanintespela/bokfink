import {
  skapaAnlaggningstillgang,
  type Anlaggningsavyttring,
  type Anlaggningstillgang,
  type Anlaggningstillgangsuppgifter,
} from '../domain/anlaggning/anlaggningstillgang';
import {
  avskrivningsforslag,
  avskrivningsunderlag,
  type Avskrivningsforslag,
} from '../domain/anlaggning/avskrivning';
import { add, negate, ZERO, type Ore } from '../domain/belopp/ore';
import type { Uuid } from '../domain/id/uuidv7';
import type { Kontonummer } from '../domain/konto/konto';
import { omfattar, type Rakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { beraknaSaldon } from '../domain/rapport/saldon';
import { halvtPrisbasbelopp } from '../domain/skatt/skattetabell';
import { lasEgnaPrisbasbelopp } from './skattetal';
import { ar, type Datum } from '../domain/tid/datum';
import type { Verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast, type BokfortVerifikat } from '../domain/verifikat/verifikat';
import { lasTillstand, tillampa } from './bokforing';
import type { KonteraDatabase } from './db';
import { bokforUtkast, huvud, nyttId, type Skrivkontext } from './kommandon';

export async function registreraAnlaggningstillgang(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  uppgifter: Omit<Anlaggningstillgangsuppgifter, 'id'>,
): Promise<Anlaggningstillgang> {
  const tillgang = skapaAnlaggningstillgang({ id: nyttId(kontext), ...uppgifter });
  await tillampa(db, { ...huvud(kontext), typ: 'anlaggning.registrerad', tillgang });
  return tillgang;
}

export async function avyttraAnlaggningstillgang(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  tillgangId: Uuid,
  avyttring: Anlaggningsavyttring,
): Promise<void> {
  // Validated again here even though avyttra() also checks: a stale read of
  // the register must not silently overwrite a sale another device already
  // recorded. tillampa() re-reads the current row before applying the
  // effect, so this call's only job is to shape the log entry.
  await tillampa(db, {
    ...huvud(kontext),
    typ: 'anlaggning.avyttrad',
    tillgangId,
    avyttring,
  });
}

export interface Arsavskrivningsunderlag {
  readonly ib: Ore;
  readonly aretsInkop: Ore;
  readonly aretsAvyttrat: Ore;
  readonly forslag: Avskrivningsforslag;
}

/**
 * The year's pool figures and all three depreciation methods, read from the
 * ledger rather than the register.
 *
 * The register (Anlaggningstillgang) exists for traceability and for
 * kompletteringsregeln - the pool itself (BFN K1 punkt 6.38) is what the
 * pool accounts' own postings say, the same way a huvudbok or a SIE export
 * already reads any other account. A purchase debits the pool; a sale
 * credits it with the proceeds (punkt 6.37) - so splitting the year's
 * movement into "inköp" and "avyttrat" is just separating the positive
 * postings from the negative ones.
 *
 * `poolkonton` takes more than one account because that is how this ledger
 * actually carries it: gross anskaffningsvärde on 1220 and accumulated
 * depreciation on 1229 as its own contra-asset, rather than one account net.
 * Their combined ingående balance and combined movement is the pool BFN
 * describes - a single-account chart of accounts just passes one konto.
 */
export async function berakningAvArsAvskrivning(
  db: KonteraDatabase,
  rakenskapsar: Rakenskapsar,
  poolkonton: readonly Kontonummer[],
): Promise<Arsavskrivningsunderlag> {
  const tillstand = await lasTillstand(db);
  const iAret = [...tillstand.verifikat.values()].filter((v) =>
    omfattar(rakenskapsar, v.datum),
  );

  const poolkontoSet = new Set(poolkonton);
  const saldon = beraknaSaldon(rakenskapsar.ingaendeBalanser, iAret);
  const ib = [...poolkontoSet].reduce(
    (summa, konto) => add(summa, saldon.get(konto)?.ingaende ?? ZERO),
    ZERO,
  );

  let aretsInkop = ZERO;
  let aretsAvyttrat = ZERO;
  for (const verifikat of iAret) {
    for (const rad of verifikat.konteringar) {
      if (!poolkontoSet.has(rad.konto)) {
        continue;
      }
      if (rad.belopp >= ZERO) {
        aretsInkop = add(aretsInkop, rad.belopp);
      } else {
        aretsAvyttrat = add(aretsAvyttrat, negate(rad.belopp));
      }
    }
  }

  const underlag = avskrivningsunderlag(ib, aretsInkop, aretsAvyttrat);
  const innehav = [...tillstand.anlaggningar.values()];
  const forslag = avskrivningsforslag(
    underlag,
    innehav,
    rakenskapsar.slut,
    /*
     * The year's own limit, not the one for the day this is run. Skatteverket
     * gives the halvt prisbasbelopp per inkomstår ("29 600 kronor för
     * inkomstår 2026", Avdrag för värdeminskning), and BFNAR 2006:1 punkt
     * 6.38 uses the same limit. A year is depreciated after it has ended,
     * often before next year's prisbasbelopp is decided.
     */
    halvtPrisbasbelopp(ar(rakenskapsar.slut), await lasEgnaPrisbasbelopp(db)),
  );

  return { ib, aretsInkop, aretsAvyttrat, forslag };
}

/**
 * Books the year's chosen depreciation figure: a cost on avskrivningskonto,
 * a matching write-down on ackAvskrivningKonto. Which of the parallel
 * figures {@link berakningAvArsAvskrivning} offered to use is entirely
 * the owner's call (hard rule 10) - this only ever books the amount it is
 * given.
 */
export async function bokforAvskrivning(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  datum: Datum,
  serie: Verifikatserie,
  belopp: Ore,
  avskrivningskostnadKonto: Kontonummer,
  ackAvskrivningKonto: Kontonummer,
): Promise<BokfortVerifikat> {
  const utkast = skapaUtkast({
    id: nyttId(kontext),
    datum,
    beskrivning: 'Årets avskrivning på maskiner och inventarier',
    konteringar: [
      { konto: avskrivningskostnadKonto, belopp },
      { konto: ackAvskrivningKonto, belopp: negate(belopp) },
    ],
  });
  return bokforUtkast(db, kontext, utkast, serie);
}
