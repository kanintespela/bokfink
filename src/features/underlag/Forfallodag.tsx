import { useState } from 'react';

import { datum, type Datum } from '../../domain/tid/datum';
import { hittaForfallodag } from '../../domain/underlag/kvittotolkning';
import type { Underlag } from '../../domain/underlag/underlag';

interface Props {
  readonly underlag: Underlag;
  /** Undefined removes the due date. */
  readonly onSpara: (forfallodag: Datum | undefined) => Promise<void>;
  /** Reads the file's text when it has not been read yet, and returns it. */
  readonly onLas: () => Promise<string>;
}

/**
 * The due date of an invoice waiting to be paid.
 *
 * What the invoice says is offered in the field, never saved on its own
 * (hard rule 10): the reminder is only as good as the date, and a misread
 * one nobody looked at would be trusted. Reading the file is a tap of its
 * own because a photograph means starting the OCR engine, which is slow the
 * first time.
 */
export function Forfallodag({ underlag, onSpara, onLas }: Props) {
  const [redigerar, setRedigerar] = useState(false);
  const [varde, setVarde] = useState('');
  const [foreslagen, setForeslagen] = useState(false);
  const [arbetar, setArbetar] = useState(false);
  const [fel, setFel] = useState<string | undefined>();

  function oppna() {
    const forslag =
      underlag.text === undefined ? undefined : hittaForfallodag(underlag.text);
    setVarde(underlag.forfallodag ?? forslag ?? '');
    setForeslagen(underlag.forfallodag === undefined && forslag !== undefined);
    setFel(undefined);
    setRedigerar(true);
  }

  async function kor(arbete: () => Promise<void>) {
    setArbetar(true);
    setFel(undefined);
    try {
      await arbete();
    } catch (orsak) {
      // Hard rule 11: shown next to the field it concerns.
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setArbetar(false);
    }
  }

  if (!redigerar) {
    return (
      <button
        type="button"
        className="knapp knapp--text"
        data-testid={`forfallodag-${underlag.id}`}
        onClick={oppna}
      >
        {underlag.forfallodag === undefined
          ? 'Ange förfallodag'
          : `Betalas senast ${underlag.forfallodag}`}
      </button>
    );
  }

  const faltId = `forfallodag-falt-${underlag.id}`;
  return (
    <div className="faltgrupp">
      <label htmlFor={faltId}>Förfallodag</label>
      <input
        id={faltId}
        className="falt"
        type="date"
        value={varde}
        onChange={(handelse) => {
          setVarde(handelse.target.value);
          setForeslagen(false);
        }}
      />
      {foreslagen && (
        <p className="hjalptext" data-testid="forfallodag-forslag">
          Läst ur fakturan. Kontrollera datumet innan du sparar.
        </p>
      )}
      {underlag.text === undefined && (
        <button
          type="button"
          className="knapp knapp--text"
          disabled={arbetar}
          onClick={() =>
            void kor(async () => {
              const forslag = hittaForfallodag(await onLas());
              if (forslag === undefined) {
                throw new Error('Ingen förfallodag hittades i underlaget.');
              }
              setVarde(forslag);
              setForeslagen(true);
            })
          }
        >
          Läs förfallodagen ur underlaget
        </button>
      )}
      <p>
        <button
          type="button"
          className="knapp"
          disabled={arbetar || varde.length === 0}
          data-testid={`spara-forfallodag-${underlag.id}`}
          onClick={() =>
            void kor(async () => {
              await onSpara(datum(varde));
              setRedigerar(false);
            })
          }
        >
          Spara
        </button>{' '}
        {underlag.forfallodag !== undefined && (
          <button
            type="button"
            className="knapp knapp--text"
            disabled={arbetar}
            onClick={() =>
              void kor(async () => {
                await onSpara(undefined);
                setRedigerar(false);
              })
            }
          >
            Ta bort förfallodagen
          </button>
        )}
        <button
          type="button"
          className="knapp knapp--text"
          disabled={arbetar}
          onClick={() => setRedigerar(false)}
        >
          Avbryt
        </button>
      </p>
      {fel !== undefined && <p role="alert">{fel}</p>}
    </div>
  );
}
