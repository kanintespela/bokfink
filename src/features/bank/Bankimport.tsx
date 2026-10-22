import { useRef, useState } from 'react';

import { formatKronor } from '../../domain/belopp/ore';
import type { Banktransaktion } from '../../domain/bank/kontoutdrag';
import type { Matchning } from '../../domain/bank/matchning';
import { Tillbaka } from '../../ui/Tillbaka';

interface Props {
  /** Reads the picked file and matches it, or throws with a readable reason. */
  readonly onLasFil: (fil: File) => Promise<readonly Matchning[]>;
  readonly onBokfor: (transaktion: Banktransaktion) => void;
  readonly onTillbaka: () => void;
}

/**
 * Reconciling the company account against the books.
 *
 * The question it answers is "what have I forgotten?", so the missing lines
 * are the whole screen and the matched ones are a number. Nothing is booked
 * from here: a line becomes a filled-in form that the person approves, which
 * is hard rule 10 and also the only way the account and the VAT rate can be
 * chosen by someone who knows what the purchase was.
 */
export function Bankimport({ onLasFil, onBokfor, onTillbaka }: Props) {
  const valjare = useRef<HTMLInputElement>(null);
  const [matchningar, setMatchningar] = useState<readonly Matchning[] | undefined>();
  const [arbetar, setArbetar] = useState(false);
  const [fel, setFel] = useState<string | undefined>();

  const saknade = (matchningar ?? []).filter((rad) => rad.verifikat === undefined);
  const matchade = (matchningar ?? []).length - saknade.length;

  return (
    <section aria-label="Bankimport">
      <Tillbaka onTillbaka={onTillbaka} />
      <h2>Stäm av kontoutdrag</h2>

      <p className="tomt">
        Läs in ett kontoutdrag som CSV från banken. Bokfink visar vilka rader som redan är
        bokförda och vilka som saknas. Filen stannar på enheten.
      </p>

      <input
        ref={valjare}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        hidden
        data-testid="valj-kontoutdrag"
        onChange={(handelse) => {
          const fil = handelse.target.files?.[0];
          if (valjare.current !== null) {
            valjare.current.value = '';
          }
          if (fil === undefined) {
            return;
          }
          setArbetar(true);
          setFel(undefined);
          onLasFil(fil)
            .then(setMatchningar)
            .catch((orsak: unknown) => {
              // Hard rule 11: a file that could not be read says why.
              setFel(orsak instanceof Error ? orsak.message : String(orsak));
              setMatchningar(undefined);
            })
            .finally(() => setArbetar(false));
        }}
      />

      <p>
        <button
          type="button"
          className="knapp knapp--primar"
          disabled={arbetar}
          onClick={() => valjare.current?.click()}
        >
          Välj kontoutdrag
        </button>
      </p>

      {fel !== undefined && (
        <p role="alert" data-testid="bank-fel">
          {fel}
        </p>
      )}

      {matchningar !== undefined && (
        <>
          <p data-testid="bank-sammanfattning">
            {matchningar.length} rader lästes. {matchade} finns redan i bokföringen,{' '}
            {saknade.length} saknas.
          </p>

          {saknade.length === 0 ? (
            <p className="tomt" data-testid="inget-saknas">
              Allt på utdraget är bokfört.
            </p>
          ) : (
            <ul className="lista" data-testid="saknade-rader">
              {saknade.map((rad, index) => (
                <li key={`${rad.transaktion.datum}-${index}`}>
                  <button
                    type="button"
                    className="listrad"
                    onClick={() => onBokfor(rad.transaktion)}
                  >
                    <span className="listrad__text">
                      <span>{rad.transaktion.text}</span>
                      <span className="listrad__sekundar">{rad.transaktion.datum}</span>
                    </span>
                    <span
                      className={`belopp${rad.transaktion.belopp < 0 ? ' belopp--negativ' : ''}`}
                    >
                      {formatKronor(rad.transaktion.belopp)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
