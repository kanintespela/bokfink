import { useMemo, useState } from 'react';

import { formatKronor, isZero } from '../../domain/belopp/ore';
import type { Konto, Kontonummer } from '../../domain/konto/konto';
import type { Ingaendebalans } from '../../domain/rakenskapsar/rakenskapsar';
import { beraknaSaldon } from '../../domain/rapport/saldon';
import { kontoutdrag } from '../../domain/rapport/kontoutdrag';
import { beteckning, type BokfortVerifikat } from '../../domain/verifikat/verifikat';
import { huvudbokTabell } from '../../domain/export/tabeller';
import { Exportknappar } from '../rapport/Exportknappar';
import { useFilprefix } from '../../ui/bok';

interface Props {
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly verifikat: readonly BokfortVerifikat[];
  readonly ingaendeBalanser: readonly Ingaendebalans[];
}

/**
 * The huvudbok: every account that moved, and what moved it.
 *
 * Bookkeeping in systematic order, as bokföringslagen 5 kap. 1 § requires
 * alongside the chronological kind. The verifikationslista answers "what did
 * I book"; this answers "what is on account 4010", which is the question
 * asked at a bokslut and by anyone checking a figure in a report.
 *
 * Accounts are closed by default and open one at a time. A ledger with three
 * hundred accounts is unreadable if every one of them is expanded, and the
 * figure wanted most often is the closing balance rather than the lines
 * behind it.
 */
export function Huvudbok({ konton, verifikat, ingaendeBalanser }: Props) {
  const filprefix = useFilprefix();
  const [oppet, setOppet] = useState<Kontonummer | undefined>();

  const saldon = useMemo(
    () => beraknaSaldon(ingaendeBalanser, verifikat),
    [ingaendeBalanser, verifikat],
  );

  const rader = useMemo(
    () =>
      [...saldon.values()]
        .filter((saldo) => !(isZero(saldo.ingaende) && isZero(saldo.forandring)))
        .sort((a, b) => a.konto.localeCompare(b.konto)),
    [saldon],
  );

  if (rader.length === 0) {
    return (
      <p className="tomt" data-testid="tom-huvudbok">
        Inget konto har rört sig ännu.
      </p>
    );
  }

  return (
    <>
      <Exportknappar
        tabell={huvudbokTabell(saldon, verifikat, konton)}
        namn={`${filprefix}-huvudbok`}
      />

      <ul className="lista" data-testid="huvudbok">
        {rader.map((saldo) => {
          const visas = oppet === saldo.konto;
          const utdrag = visas
            ? kontoutdrag(saldo.konto, saldo.ingaende, verifikat)
            : undefined;

          return (
            <li key={saldo.konto}>
              <button
                type="button"
                className="listrad"
                aria-expanded={visas}
                onClick={() => setOppet(visas ? undefined : saldo.konto)}
              >
                <span className="listrad__text">
                  <span>{saldo.konto}</span>
                  <span className="listrad__sekundar">
                    {konton.get(saldo.konto)?.namn ?? ''}
                  </span>
                </span>
                <span className={`belopp${saldo.utgaende < 0 ? ' belopp--negativ' : ''}`}>
                  {formatKronor(saldo.utgaende)}
                </span>
              </button>

              {utdrag !== undefined && (
                <div data-testid={`huvudbok-${saldo.konto}`}>
                  <dl>
                    <dt>Ingående balans</dt>
                    <dd className="belopp">{formatKronor(utdrag.ingaende)}</dd>
                    <dt>Årets förändring</dt>
                    <dd className="belopp">{formatKronor(saldo.forandring)}</dd>
                    <dt>Utgående balans</dt>
                    <dd className="belopp">
                      <strong>{formatKronor(utdrag.utgaende)}</strong>
                    </dd>
                  </dl>

                  <ul className="lista">
                    {utdrag.rader.map((rad, index) => (
                      <li key={`${rad.verifikat.id}-${index}`}>
                        <div className="listrad">
                          <span className="listrad__text">
                            <span>
                              {rad.datum} · {beteckning(rad.verifikat)}
                            </span>
                            <span className="listrad__sekundar">{rad.text}</span>
                          </span>
                          <span
                            className={`belopp${rad.belopp < 0 ? ' belopp--negativ' : ''}`}
                          >
                            {formatKronor(rad.belopp)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
