import { useMemo, useState } from 'react';

import { formatKronor, ZERO } from '../../domain/belopp/ore';
import type { Konto, Kontonummer } from '../../domain/konto/konto';
import { kontoutdrag } from '../../domain/rapport/kontoutdrag';
import type { Ingaendebalans } from '../../domain/rakenskapsar/rakenskapsar';
import { beteckning, type BokfortVerifikat } from '../../domain/verifikat/verifikat';

interface Props {
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly verifikat: readonly BokfortVerifikat[];
  readonly ingaendeBalanser: readonly Ingaendebalans[];
  /** The accounts money actually moves through, offered first. */
  readonly betalkonton: readonly Kontonummer[];
}

/**
 * Money in and out, one account at a time.
 *
 * A different question from the verifikationslista: this one is checked
 * against a bank statement, that one against a pile of receipts. Hence the
 * running balance, which is the column that makes the two comparable line by
 * line rather than only at the bottom.
 */
export function Handelser({ konton, verifikat, ingaendeBalanser, betalkonton }: Props) {
  const [valt, setValt] = useState<Kontonummer | undefined>(betalkonton[0]);

  const utdrag = useMemo(() => {
    if (valt === undefined) {
      return undefined;
    }
    const ingaende = ingaendeBalanser.find((post) => post.konto === valt)?.belopp ?? ZERO;
    return kontoutdrag(valt, ingaende, verifikat);
  }, [valt, ingaendeBalanser, verifikat]);

  return (
    <>
      <div className="faltgrupp">
        <label htmlFor="handelsekonto">Konto</label>
        <select
          id="handelsekonto"
          className="falt"
          value={valt ?? ''}
          onChange={(handelse) => setValt(handelse.target.value as Kontonummer)}
        >
          {betalkonton.map((konto) => (
            <option key={konto} value={konto}>
              {konto} {konton.get(konto)?.namn ?? ''}
            </option>
          ))}
        </select>
      </div>

      {utdrag === undefined || utdrag.rader.length === 0 ? (
        <p className="tomt" data-testid="inga-handelser">
          Ingenting har rört det här kontot ännu.
        </p>
      ) : (
        <>
          <dl data-testid="handelsesummering">
            <dt>Ingående saldo</dt>
            <dd className="belopp">{formatKronor(utdrag.ingaende)}</dd>
            <dt>In</dt>
            <dd className="belopp">{formatKronor(utdrag.in)}</dd>
            <dt>Ut</dt>
            <dd className="belopp belopp--negativ">{formatKronor(utdrag.ut)}</dd>
            <dt>Utgående saldo</dt>
            <dd className="belopp">
              <strong>{formatKronor(utdrag.utgaende)}</strong>
            </dd>
          </dl>

          <ul className="lista" data-testid="handelselista">
            {[...utdrag.rader].reverse().map((rad, index) => (
              <li key={`${rad.verifikat.id}-${index}`}>
                <div className="listrad">
                  <span className="listrad__text">
                    <span>
                      {rad.datum} · {beteckning(rad.verifikat)}
                    </span>
                    <span className="listrad__sekundar">{rad.text}</span>
                  </span>
                  <span className="listrad__text" style={{ textAlign: 'right' }}>
                    <span className={`belopp${rad.belopp < 0 ? ' belopp--negativ' : ''}`}>
                      {formatKronor(rad.belopp)}
                    </span>
                    <span className="listrad__sekundar belopp">
                      {formatKronor(rad.saldo)}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
