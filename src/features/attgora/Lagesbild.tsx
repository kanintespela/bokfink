import { useMemo } from 'react';

import { formatKronor, negate } from '../../domain/belopp/ore';
import { likvidaMedel, momsskuld } from '../../domain/rapport/nyckeltal';
import { aretsResultat } from '../../domain/rapport/resultatrakning';
import { beraknaSaldon } from '../../domain/rapport/saldon';
import type { Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import type { Datum } from '../../domain/tid/datum';
import type { BokfortVerifikat } from '../../domain/verifikat/verifikat';

interface Props {
  readonly verifikat: readonly BokfortVerifikat[];
  readonly rakenskapsar: readonly Rakenskapsar[];
  readonly idag: Datum;
  /** The full reports, with the pictures behind these figures. */
  readonly onRapporter: () => void;
}

/**
 * The year in three figures, on the overview.
 *
 * Every bookkeeping app people know opens on something like this - am I
 * making anything, is there money, what do I owe Skatteverket - and until
 * now the answer was three taps down under Rapporter. The figures are the
 * same ones Nyckeltal shows, from the same functions, and the card leads
 * there for the months and the pictures.
 */
export function Lagesbild({ verifikat, rakenskapsar, idag, onRapporter }: Props) {
  const tal = useMemo(() => {
    const aret =
      rakenskapsar.find((ar) => idag >= ar.start && idag <= ar.slut) ??
      [...rakenskapsar].sort((a, b) => b.start.localeCompare(a.start))[0];
    if (aret === undefined) {
      return undefined;
    }
    const saldon = beraknaSaldon(
      aret.ingaendeBalanser,
      verifikat.filter((post) => post.datum >= aret.start && post.datum <= aret.slut),
    );
    return {
      ar: aret.start.slice(0, 4),
      resultat: aretsResultat(saldon),
      likvida: likvidaMedel(saldon),
      moms: momsskuld(saldon),
    };
  }, [rakenskapsar, verifikat, idag]);

  if (tal === undefined) {
    return null;
  }

  return (
    <>
      <h2>Läget {tal.ar}</h2>
      <div className="kort" data-testid="lagesbild">
        <dl className="nyckeltal lagesbild">
          <dt>Resultat</dt>
          <dd className={tal.resultat < 0 ? 'belopp--negativ' : ''}>
            {formatKronor(tal.resultat)}
          </dd>

          <dt>Pengar i kassa och bank</dt>
          <dd className={tal.likvida < 0 ? 'belopp--negativ' : ''}>
            {formatKronor(tal.likvida)}
          </dd>

          <dt>{tal.moms < 0 ? 'Moms att få tillbaka' : 'Moms att betala'}</dt>
          <dd>{formatKronor(tal.moms < 0 ? negate(tal.moms) : tal.moms)}</dd>
        </dl>
        <button type="button" className="knapp knapp--text" onClick={onRapporter}>
          Visa rapporter
        </button>
      </div>
    </>
  );
}
