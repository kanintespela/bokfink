import { useState } from 'react';

import type { Konto, Kontonummer } from '../../domain/konto/konto';
import type { Ingaendebalans } from '../../domain/rakenskapsar/rakenskapsar';
import type { BokfortVerifikat } from '../../domain/verifikat/verifikat';
import type { Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import type { Datum } from '../../domain/tid/datum';
import { Tillbaka } from '../../ui/Tillbaka';
import { Huvudbok } from '../huvudbok/Huvudbok';
import { Nyckeltal } from '../rapport/Nyckeltal';
import { Rakningar } from '../rapport/Rakningar';
import { Handelser } from './Handelser';

type Rapport = 'nyckeltal' | 'resultat' | 'balans' | 'huvudbok' | 'handelser';

const NAMN: Record<Rapport, string> = {
  nyckeltal: 'Nyckeltal',
  resultat: 'Resultat',
  balans: 'Balans',
  huvudbok: 'Huvudbok',
  handelser: 'Händelser',
};

interface Props {
  readonly onTillbaka: () => void;
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly verifikat: readonly BokfortVerifikat[];
  readonly ingaendeBalanser: readonly Ingaendebalans[];
  readonly betalkonton: readonly Kontonummer[];
  /** Every year and every verifikat, so a report can compare with last year. */
  readonly rakenskapsar: readonly Rakenskapsar[];
  readonly allaVerifikat: readonly BokfortVerifikat[];
  readonly idag: Datum;
}

/**
 * The reports, switched inside one view rather than each taking a tab.
 *
 * Four tabs is what a phone holds along the bottom, and the plan has resultat
 * and balans arriving in stage 4. Putting them behind one entry keeps the
 * navigation the same size when they do.
 */
export function Rapporter(props: Props) {
  const [vald, setVald] = useState<Rapport>('nyckeltal');

  return (
    <section aria-label="Rapporter">
      <Tillbaka onTillbaka={props.onTillbaka} />
      <h2>{NAMN[vald]}</h2>

      <div className="segment" style={{ marginBottom: '1rem' }}>
        {(Object.keys(NAMN) as Rapport[])
          .filter((rapport) => rapport !== 'handelser')
          .map((rapport) => (
            <button
              key={rapport}
              type="button"
              aria-pressed={vald === rapport}
              onClick={() => setVald(rapport)}
            >
              {NAMN[rapport]}
            </button>
          ))}
      </div>

      <p>
        <button
          type="button"
          className="knapp knapp--text"
          aria-pressed={vald === 'handelser'}
          onClick={() => setVald('handelser')}
        >
          Händelser
        </button>
      </p>

      {vald === 'nyckeltal' && (
        <Nyckeltal
          konton={props.konton}
          verifikat={props.allaVerifikat}
          rakenskapsar={props.rakenskapsar}
          idag={props.idag}
        />
      )}

      {(vald === 'resultat' || vald === 'balans') && (
        <Rakningar
          konton={props.konton}
          verifikat={props.allaVerifikat}
          rakenskapsar={props.rakenskapsar}
          vilken={vald}
        />
      )}

      {vald === 'huvudbok' && (
        <Huvudbok
          konton={props.konton}
          verifikat={props.verifikat}
          ingaendeBalanser={props.ingaendeBalanser}
        />
      )}

      {vald === 'handelser' && (
        <Handelser
          konton={props.konton}
          verifikat={props.verifikat}
          ingaendeBalanser={props.ingaendeBalanser}
          betalkonton={props.betalkonton}
        />
      )}
    </section>
  );
}
