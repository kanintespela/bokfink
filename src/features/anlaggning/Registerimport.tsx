import { useRef, useState } from 'react';

import type { Registerimportplan } from '../../data/registerimport';
import { formatKronor } from '../../domain/belopp/ore';
import { lasValdaFiler } from '../../platform/fil';
import { Uppgiftsstatus, useUppgift } from '../data/uppgift';

interface Props {
  /** Reads a file and says what taking it in would do. Writes nothing. */
  readonly onPlanera: (text: string) => Promise<Registerimportplan>;
  readonly onGenomfor: (plan: Registerimportplan) => Promise<number>;
}

const KATEGORINAMN = {
  byggnad: 'Byggnad',
  markanlaggning: 'Markanläggning',
  mark: 'Mark',
  skog: 'Skog',
} as const;

/**
 * Takes in a register of assets that was kept somewhere else.
 *
 * Two steps, and the first writes nothing: the file is read and what it
 * holds is listed, and only the button under the list registers it (hard
 * rule 10). What the register already has is said and left alone.
 */
export function Registerimport({ onPlanera, onGenomfor }: Props) {
  const valjare = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<Registerimportplan | undefined>();
  const { arbetar, besked, fel, kor } = useUppgift();
  const antal = plan === undefined ? 0 : plan.inventarier.length + plan.fastighet.length;

  return (
    <section aria-label="Läs in ett register från fil">
      <h2>Läs in ett register från fil</h2>
      <p className="hjalptext">
        Har du fört anläggningsregistret någon annanstans kan det läsas in här som en
        registerfil för Bokfink. Du får se vad filen innehåller innan något läggs in.
        Registret bokför ingenting: köpen finns redan i bokföringen.
      </p>
      <input
        ref={valjare}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="registerfil"
        onChange={(handelse) => {
          const valda = handelse.target.files;
          void kor(async () => {
            try {
              const [fil] = await lasValdaFiler(valda);
              if (fil === undefined) {
                return 'Ingen fil valdes.';
              }
              const last = await onPlanera(new TextDecoder().decode(fil.innehall));
              setPlan(last);
              return `Filen är läst. Inget är inlagt än.`;
            } finally {
              if (valjare.current !== null) {
                // So choosing the same file again still fires a change.
                valjare.current.value = '';
              }
            }
          });
        }}
      />
      <p>
        <button
          type="button"
          className="knapp"
          disabled={arbetar}
          onClick={() => valjare.current?.click()}
        >
          Välj registerfil
        </button>
      </p>

      {plan !== undefined && (
        <div className="kort" data-testid="registerimportplan">
          {antal === 0 ? (
            <p>Allt i filen finns redan i registret.</p>
          ) : (
            <ul className="lista">
              {plan.fastighet.map((rad) => (
                <li key={`f-${rad.benamning}-${rad.anskaffningsdatum}`}>
                  <span className="listrad">
                    <span className="listrad__text">
                      <strong>{rad.benamning}</strong>
                      <span className="listrad__sekundar">
                        {KATEGORINAMN[rad.kategori.typ]} · {rad.anskaffningsdatum}
                        {rad.ackumuleradAvskrivning > 0 &&
                          ` · Redan avskrivet ${formatKronor(rad.ackumuleradAvskrivning)}`}
                      </span>
                    </span>
                    <span className="belopp">{formatKronor(rad.anskaffningsvarde)}</span>
                  </span>
                </li>
              ))}
              {plan.inventarier.map((rad) => (
                <li key={`i-${rad.benamning}-${rad.anskaffningsdatum}`}>
                  <span className="listrad">
                    <span className="listrad__text">
                      <strong>{rad.benamning}</strong>
                      <span className="listrad__sekundar">
                        Maskin eller inventarie · {rad.anskaffningsdatum} ·{' '}
                        {rad.nyttjandeperiod} år
                      </span>
                    </span>
                    <span className="belopp">{formatKronor(rad.anskaffningsvarde)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {plan.finnsRedan.length > 0 && (
            <p className="hjalptext">
              Finns redan i registret och lämnas orört: {plan.finnsRedan.join(', ')}.
            </p>
          )}
          {antal > 0 && (
            <button
              type="button"
              className="knapp knapp--primar"
              disabled={arbetar}
              data-testid="genomfor-registerimport"
              onClick={() =>
                void kor(async () => {
                  const inlagda = await onGenomfor(plan);
                  setPlan(undefined);
                  return inlagda === 1
                    ? 'En anläggning är inlagd i registret.'
                    : `${inlagda} anläggningar är inlagda i registret.`;
                })
              }
            >
              {antal === 1 ? 'Lägg in den i registret' : `Lägg in ${antal} i registret`}
            </button>
          )}
          <button
            type="button"
            className="knapp knapp--text"
            onClick={() => setPlan(undefined)}
          >
            Avbryt
          </button>
        </div>
      )}

      <Uppgiftsstatus arbetar={arbetar} besked={besked} fel={fel} />
    </section>
  );
}
