import { add, isZero, negate, sum, ZERO, type Ore } from '../belopp/ore';
import { kontonummer, type Kontonummer } from '../konto/konto';
import { inomIntervall, type Datum } from '../tid/datum';
import type { BokfortVerifikat, Kontering } from '../verifikat/verifikat';
import {
  arMomsavrakning,
  beraknaMomsrapport,
  MOMSREDOVISNINGSKONTO,
} from './momsrapport';
import { standardredovisning } from './rutor';

/** BAS 3740 Öresutjämning. */
const ORESUTJAMNING = kontonummer('3740');

export class MomsredovisningFinnsError extends Error {
  constructor(fran: Datum, till: Datum) {
    super(
      `Momsen för ${fran}–${till} är redan redovisad mot 2650. Annullera den ` +
        'bokningen först om den behöver göras om.',
    );
    this.name = 'MomsredovisningFinnsError';
  }
}

export interface Momsredovisningsforslag {
  /** The period's last day, where a momsredovisning is always booked. */
  readonly datum: Datum;
  readonly beskrivning: string;
  readonly konteringar: readonly Kontering[];
}

/**
 * The momsredovisning for a period: every moms account emptied into 2650.
 *
 * What goes onto 2650 is box 49 as the declaration states it, not the sum of
 * the accounts - Skatteverket is owed, or owes, the whole kronor the return
 * says (skatteförfarandeförordning 22 kap. 1 §, see krontal), so that is the
 * figure 2650 has to carry for the payment to clear it. The öre the boxes
 * dropped go to 3740 Öresutjämning. That is the entry other bookkeeping
 * programs make every quarter, and the tests reproduce it to the öre.
 *
 * A suggestion only (hard rule 10): the caller books it when asked.
 */
export function momsredovisning(underlag: {
  readonly fran: Datum;
  readonly till: Datum;
  readonly verifikat: Iterable<BokfortVerifikat>;
}): Momsredovisningsforslag {
  const { fran, till } = underlag;
  const iPerioden = [...underlag.verifikat].filter((verifikat) =>
    inomIntervall(verifikat.datum, fran, till),
  );

  if (iPerioden.some((verifikat) => arMomsavrakning(verifikat.konteringar))) {
    throw new MomsredovisningFinnsError(fran, till);
  }

  const perKonto = new Map<Kontonummer, Ore>();
  for (const verifikat of iPerioden) {
    for (const rad of verifikat.konteringar) {
      if (standardredovisning(rad.konto)?.slag !== 'moms') {
        continue;
      }
      perKonto.set(rad.konto, add(perKonto.get(rad.konto) ?? ZERO, rad.belopp));
    }
  }

  const tomda: Kontering[] = [...perKonto]
    .filter(([, saldo]) => !isZero(saldo))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([konto, saldo]) => ({ konto, belopp: negate(saldo) }));

  if (tomda.length === 0) {
    throw new TypeError(`Ingen moms är bokförd för ${fran}–${till}.`);
  }

  const { attBetala } = beraknaMomsrapport({ fran, till, verifikat: iPerioden });
  // Owed is a skuld and credited; money back is a fordran and debited.
  const redovisat: Kontering = {
    konto: MOMSREDOVISNINGSKONTO,
    belopp: negate(attBetala),
  };

  // Whatever keeps the entry from balancing is the öre the boxes left out.
  const ores = negate(sum([...tomda, redovisat].map((rad) => rad.belopp)));

  return {
    datum: till,
    beskrivning: `Momsredovisning ${fran}–${till}`,
    konteringar: [
      ...tomda,
      redovisat,
      ...(isZero(ores) ? [] : [{ konto: ORESUTJAMNING, belopp: ores }]),
    ],
  };
}
