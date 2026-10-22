import {
  arsAvskrivning,
  bokfortVarde,
  skapaFastighetstillgang,
  type Fastighetsavyttring,
  type Fastighetstillgang,
  type Fastighetstillgangsuppgifter,
} from '../domain/anlaggning/fastighetstillgang';
import { add, negate, type Ore } from '../domain/belopp/ore';
import type { Uuid } from '../domain/id/uuidv7';
import type { Kontonummer } from '../domain/konto/konto';
import type { Datum } from '../domain/tid/datum';
import type { Verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast, type BokfortVerifikat } from '../domain/verifikat/verifikat';
import { lasTillstand, tillampa } from './bokforing';
import type { KonteraDatabase } from './db';
import { bokforUtkast, huvud, nyttId, type Skrivkontext } from './kommandon';

export async function registreraFastighetstillgang(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  uppgifter: Omit<Fastighetstillgangsuppgifter, 'id'>,
): Promise<Fastighetstillgang> {
  const tillgang = skapaFastighetstillgang({ id: nyttId(kontext), ...uppgifter });
  await tillampa(db, { ...huvud(kontext), typ: 'fastighet.registrerad', tillgang });
  return tillgang;
}

export async function avyttraFastighetstillgang(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  tillgangId: Uuid,
  avyttring: Fastighetsavyttring,
): Promise<void> {
  await tillampa(db, {
    ...huvud(kontext),
    typ: 'fastighet.avyttrad',
    tillgangId,
    avyttring,
  });
}

export interface Fastighetsavskrivningsforslag {
  readonly tillgang: Fastighetstillgang;
  /** Årets föreslagna avskrivning enligt tillgångens egen procentsats. */
  readonly forslag: Ore;
  readonly bokfortVardeInnan: Ore;
  readonly bokfortVardeEfter: Ore;
}

/**
 * Årets avskrivningsförslag för varje innehavd, ej avyttrad fastighetskomponent.
 *
 * Till skillnad från den kollektiva potten (se anlaggning.ts) finns ingen
 * gemensam liggarkonto att läsa - registret självt (ackumuleradAvskrivning
 * per tillgång) är källan, eftersom varje byggnad och markanläggning skrivs
 * av för sig.
 */
export async function fastighetsavskrivningsforslag(
  db: KonteraDatabase,
): Promise<readonly Fastighetsavskrivningsforslag[]> {
  const tillstand = await lasTillstand(db);
  return [...tillstand.fastigheter.values()]
    .filter((tillgang) => tillgang.avyttring === undefined)
    .map((tillgang) => {
      const forslag = arsAvskrivning(tillgang, tillgang.ackumuleradAvskrivning);
      return {
        tillgang,
        forslag,
        bokfortVardeInnan: bokfortVarde(tillgang, tillgang.ackumuleradAvskrivning),
        bokfortVardeEfter: bokfortVarde(
          tillgang,
          add(tillgang.ackumuleradAvskrivning, forslag),
        ),
      };
    });
}

/**
 * Bokför årets avskrivning på en fastighetskomponent: en kostnad på
 * avskrivningskontot, en motsvarande nedskrivning på det ackumulerade
 * kontot, och en uppdatering av registrets ackumulerade avskrivning så att
 * nästa års beräkning har rätt underlag.
 */
export async function bokforFastighetsavskrivning(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  datum: Datum,
  serie: Verifikatserie,
  tillgangId: Uuid,
  belopp: Ore,
  avskrivningskostnadKonto: Kontonummer,
  ackAvskrivningKonto: Kontonummer,
): Promise<BokfortVerifikat> {
  const utkast = skapaUtkast({
    id: nyttId(kontext),
    datum,
    beskrivning: 'Årets avskrivning på fastighetskomponent',
    konteringar: [
      { konto: avskrivningskostnadKonto, belopp },
      { konto: ackAvskrivningKonto, belopp: negate(belopp) },
    ],
  });
  const verifikat = await bokforUtkast(db, kontext, utkast, serie);
  await tillampa(db, {
    ...huvud(kontext),
    typ: 'fastighet.avskrivningBokford',
    tillgangId,
    belopp,
  });
  return verifikat;
}
