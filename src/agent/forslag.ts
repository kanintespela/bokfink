import { z } from 'zod';

import { oreFromKronor, isZero } from '../domain/belopp/ore';
import type { Uuid } from '../domain/id/uuidv7';
import { kontonummer, type Konto, type Kontonummer } from '../domain/konto/konto';
import { paverkarMomsdeklarationen } from '../domain/moms/momsrapport';
import {
  kontrolleraBokforingsbart,
  kontrolleraInteFramtida,
  omfattar,
  type Rakenskapsar,
} from '../domain/rakenskapsar/rakenskapsar';
import { datum, type Datum } from '../domain/tid/datum';
import {
  beteckning,
  omslutning,
  skapaUtkast,
  type BokfortVerifikat,
  type Kontering,
  type Verifikatutkast,
} from '../domain/verifikat/verifikat';

/**
 * A booking suggestion as the assistant writes it, before anything checks it.
 *
 * Amounts are strings of kronor, never numbers: JSON has only floats, and a
 * suggestion that passed "400.1" through one would already have broken hard
 * rule 1 before Kontera saw it. Positive is debet and negative is kredit,
 * the same sign convention every kontering in the app uses.
 */
const forslagsschema = z.object({
  datum: z.string(),
  beskrivning: z.string().trim().min(1, 'Förslaget saknar beskrivning.'),
  konteringar: z
    .array(
      z.object({
        konto: z.string(),
        belopp: z.string(),
        text: z.string().optional(),
      }),
    )
    .min(2, 'Ett verifikat måste ha minst två konteringsrader.'),
  underlag: z.array(z.string()).min(1, 'Förslaget saknar underlag.'),
});

export interface Granskningsunderlag {
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly rakenskapsar: ReadonlyMap<Uuid, Rakenskapsar>;
  readonly verifikat: ReadonlyMap<Uuid, BokfortVerifikat>;
}

export interface GranskatForslag {
  readonly utkast: Verifikatutkast;
  /** Paths to the files, as the suggestion named them. */
  readonly underlag: readonly string[];
  /** Things worth a second look that do not stop the draft. */
  readonly varningar: readonly string[];
}

/**
 * Checks a suggestion against the books it is meant for, and builds the draft.
 *
 * Everything the phone would refuse at booking is refused here instead: an
 * account the kontoplan does not have, a period that is locked, rows that do
 * not balance. A draft that can only fail when the button is pressed is a
 * draft that wastes the one review it gets.
 */
export function granskaForslag(
  indata: unknown,
  bocker: Granskningsunderlag,
  id: Uuid,
  idag: Datum,
): GranskatForslag {
  const tolkat = forslagsschema.safeParse(indata);
  if (!tolkat.success) {
    throw new TypeError(
      `Förslaget går inte att läsa: ${tolkat.error.issues
        .map((fel) => `${fel.path.join('.') || 'förslaget'}: ${fel.message}`)
        .join('; ')}`,
    );
  }
  const forslag = tolkat.data;

  const dag = datum(forslag.datum);
  // The phone would refuse it at booking; refused here, it never becomes a draft.
  kontrolleraInteFramtida(dag, idag);
  const konteringar: Kontering[] = forslag.konteringar.map((rad) => {
    const nummer = kontonummer(rad.konto);
    const konto = bocker.konton.get(nummer);
    if (konto === undefined) {
      throw new TypeError(
        `Konto ${nummer} finns inte i kontoplanen. Välj ett konto som finns, eller ` +
          'lägg upp kontot i appen först.',
      );
    }
    if (!konto.aktiv) {
      throw new TypeError(`Konto ${nummer} ${konto.namn} är inaktivt.`);
    }
    const belopp = oreFromKronor(rad.belopp);
    if (isZero(belopp)) {
      throw new TypeError(`Raden på konto ${nummer} saknar belopp.`);
    }
    return {
      konto: nummer,
      belopp,
      ...(rad.text === undefined ? {} : { text: rad.text }),
    };
  });

  const utkast = skapaUtkast({
    id,
    datum: dag,
    beskrivning: forslag.beskrivning,
    konteringar,
  });

  const ar = [...bocker.rakenskapsar.values()].find((kandidat) =>
    omfattar(kandidat, dag),
  );
  if (ar === undefined) {
    throw new TypeError(
      `Det finns inget räkenskapsår som omfattar ${dag}. Lägg upp året i appen först.`,
    );
  }
  kontrolleraBokforingsbart(ar, dag, paverkarMomsdeklarationen(konteringar));

  return { utkast, underlag: forslag.underlag, varningar: dubbletter(utkast, bocker) };
}

/**
 * Booked verifikat that look like the same purchase.
 *
 * Same date and same total is what a receipt booked once already looks like.
 * A warning rather than a refusal: two identical coffees on one day are two
 * purchases, and only the person holding the receipts can tell.
 */
function dubbletter(utkast: Verifikatutkast, bocker: Granskningsunderlag): string[] {
  const summa = omslutning(utkast);
  return [...bocker.verifikat.values()]
    .filter((post) => post.datum === utkast.datum && omslutning(post) === summa)
    .map(
      (post) =>
        `${beteckning(post)} har samma datum och belopp: ${post.beskrivning}. ` +
        'Kontrollera att kvittot inte redan är bokfört.',
    );
}
