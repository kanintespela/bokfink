import { useState } from 'react';

import { linjaraAvskrivningar } from '../../domain/anlaggning/linjaravskrivning';
import type { Anlaggningstillgang } from '../../domain/anlaggning/anlaggningstillgang';
import { formatKronor, type Ore } from '../../domain/belopp/ore';
import { kontonummer, type Kontonummer } from '../../domain/konto/konto';
import { ar as arAv } from '../../domain/tid/datum';
import type { Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';

interface Props {
  readonly anlaggningar: readonly Anlaggningstillgang[];
  /** The year being depreciated, chosen on the screen above. */
  readonly rakenskapsar: Rakenskapsar | undefined;
  readonly arbetar: boolean;
  /** Runs a step that can fail and shows the failure where the screen does. */
  readonly kor: (uppgift: () => Promise<string>) => Promise<void>;
  readonly onBokfor: (
    belopp: Ore,
    kostnadskonto: Kontonummer,
    ackKonto: Kontonummer,
  ) => Promise<string>;
}

/**
 * The year's depreciation of an association's inventarier, asset by asset.
 *
 * BFNAR 2010:1 punkt 6.34-6.35: each asset is written off in equal amounts
 * over the time it is meant to be used, not as one pool. The amounts come from
 * the register, so an asset that is not in it is not in the figure, and the
 * screen says so. The sum is shown before anything is booked and nothing is
 * booked until it is pressed (hard rule 10).
 */
export function Linjaravskrivningssektion({
  anlaggningar,
  rakenskapsar,
  arbetar,
  kor,
  onBokfor,
}: Props) {
  const [kostnadText, setKostnadText] = useState('7830');
  const [ackText, setAckText] = useState('1228');

  if (rakenskapsar === undefined) {
    return (
      <p className="tomt" data-testid="linjar-inget-ar">
        Lägg upp ett räkenskapsår först.
      </p>
    );
  }

  const { rader, summa } = linjaraAvskrivningar(anlaggningar, arAv(rakenskapsar.slut));

  return (
    <div className="kort" data-testid="linjar-avskrivning">
      <p className="hjalptext">
        Varje inventarie skrivs av för sig, med lika stort belopp varje år under sin
        nyttjandeperiod, från det år den köptes (BFNAR 2010:1, punkt 6.34–6.35). Det året
        räknas som ett helt år, och ingenting skrivs av det år en tillgång säljs eller
        utrangeras. Bara det som finns i registret ovan räknas med.
      </p>

      {rader.length === 0 ? (
        <p className="tomt" data-testid="linjar-inga-rader">
          Ingen registrerad tillgång har någon avskrivning det här året.
        </p>
      ) : (
        <ul className="lista" data-testid="linjar-rader">
          {rader.map((rad) => (
            <li key={rad.tillgang.id}>
              <div className="listrad">
                <span className="listrad__text">
                  <span>{rad.tillgang.benamning}</span>
                  <span className="listrad__sekundar">
                    {rad.tillgang.anskaffningsdatum} · {rad.tillgang.nyttjandeperiod} år
                  </span>
                </span>
                <span className="belopp">{formatKronor(rad.belopp)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <dl>
        <dt>Årets avskrivning</dt>
        <dd className="belopp" data-testid="linjar-summa">
          <strong>{formatKronor(summa)}</strong>
        </dd>
      </dl>

      <div className="faltgrupp">
        <label htmlFor="linjar-kostnadskonto">Kostnadskonto för avskrivningen</label>
        <input
          id="linjar-kostnadskonto"
          className="falt"
          inputMode="numeric"
          value={kostnadText}
          onChange={(handelse) => setKostnadText(handelse.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="linjar-ackkonto">Kontot för ackumulerade avskrivningar</label>
        <input
          id="linjar-ackkonto"
          className="falt"
          inputMode="numeric"
          value={ackText}
          onChange={(handelse) => setAckText(handelse.target.value)}
        />
      </div>

      <button
        type="button"
        className="knapp knapp--primar"
        disabled={arbetar || summa <= 0}
        data-testid="bokfor-linjar-avskrivning"
        onClick={() =>
          void kor(() => onBokfor(summa, kontonummer(kostnadText), kontonummer(ackText)))
        }
      >
        Bokför {formatKronor(summa)} kr
      </button>
    </div>
  );
}
