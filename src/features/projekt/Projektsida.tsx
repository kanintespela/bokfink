import { useMemo, useState } from 'react';

import {
  LANGSTA_PROJEKTKOD,
  LANGSTA_PROJEKTNAMN,
  type Projekt,
} from '../../domain/projekt/projekt';
import type { Uuid } from '../../domain/id/uuidv7';
import { Tillbaka } from '../../ui/Tillbaka';
import { Uppgiftsstatus, useUppgift } from '../data/uppgift';

interface Props {
  readonly projekt: readonly Projekt[];
  readonly onTillbaka: () => void;
  readonly onSkapa: (uppgifter: { kod: string; namn: string }) => Promise<void>;
  readonly onAndra: (
    id: Uuid,
    andring: { readonly namn?: string; readonly avslutat?: boolean },
  ) => Promise<void>;
}

/**
 * The projects a rad can be booked on: a code and a name each.
 *
 * Kept as a list of its own rather than typed into a field on the form, so
 * that "LEADER-28" and "Leader 28" cannot become two projects in a report.
 * The code is what a file calls the project and is fixed once given; the
 * name can be changed, and a project that is over is finished, not removed -
 * what was booked on it stays, and it can be reopened.
 */
export function Projektsida({ projekt, onTillbaka, onSkapa, onAndra }: Props) {
  const [kod, setKod] = useState('');
  const [namn, setNamn] = useState('');
  /** The project being renamed, and what its name is being changed to. */
  const [byterNamn, setByterNamn] = useState<{ id: Uuid; namn: string } | undefined>();
  const { arbetar, besked, fel, kor } = useUppgift();

  const sorterade = useMemo(
    () =>
      [...projekt].sort(
        (a, b) =>
          Number(a.avslutat) - Number(b.avslutat) || a.kod.localeCompare(b.kod, 'sv'),
      ),
    [projekt],
  );

  return (
    <section aria-label="Projekt">
      <Tillbaka onTillbaka={onTillbaka} />
      <h2>Projekt</h2>
      <p className="hjalptext">
        Ett projekt är till exempel ett bidrag eller ett arrangemang som du vill kunna
        följa för sig. På en rad i ett verifikat kan du välja ett projekt, men du behöver
        inte. Koden kan inte ändras efteråt, eftersom den är projektets namn i de filer
        som lämnar appen; namnet kan du ändra.
      </p>

      {sorterade.length === 0 ? (
        <p className="tomt" data-testid="inga-projekt">
          Inga projekt än.
        </p>
      ) : (
        <ul className="lista" data-testid="projektlista">
          {sorterade.map((post) => (
            <li key={post.id}>
              <div className="listrad">
                <span className="listrad__text">
                  <span>
                    {post.kod} {post.namn}
                  </span>
                  <span className="listrad__sekundar">
                    {post.avslutat ? 'Avslutat' : 'Pågår'}
                  </span>
                </span>
                <button
                  type="button"
                  className="knapp knapp--text"
                  disabled={arbetar}
                  data-testid={`byt-namn-${post.kod}`}
                  onClick={() => setByterNamn({ id: post.id, namn: post.namn })}
                >
                  Byt namn
                </button>
                <button
                  type="button"
                  className="knapp knapp--text"
                  disabled={arbetar}
                  data-testid={`${post.avslutat ? 'oppna' : 'avsluta'}-${post.kod}`}
                  onClick={() =>
                    void kor(async () => {
                      await onAndra(post.id, { avslutat: !post.avslutat });
                      return post.avslutat
                        ? `${post.kod} är öppnat igen.`
                        : `${post.kod} är avslutat. Det som är bokfört på det ligger kvar, men det tar inga nya rader.`;
                    })
                  }
                >
                  {post.avslutat ? 'Öppna igen' : 'Avsluta'}
                </button>
              </div>
              {byterNamn?.id === post.id && (
                <div className="faltgrupp">
                  <label htmlFor="projekt-nytt-namn">Nytt namn för {post.kod}</label>
                  <input
                    id="projekt-nytt-namn"
                    className="falt"
                    maxLength={LANGSTA_PROJEKTNAMN}
                    value={byterNamn.namn}
                    onChange={(handelse) =>
                      setByterNamn({ id: post.id, namn: handelse.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="knapp"
                    disabled={arbetar}
                    data-testid="spara-projektnamn"
                    onClick={() =>
                      void kor(async () => {
                        await onAndra(post.id, { namn: byterNamn.namn });
                        setByterNamn(undefined);
                        return `${post.kod} heter nu ${byterNamn.namn.trim()}.`;
                      })
                    }
                  >
                    Spara namnet
                  </button>
                  <button
                    type="button"
                    className="knapp knapp--text"
                    onClick={() => setByterNamn(undefined)}
                  >
                    Avbryt
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>Nytt projekt</h3>

      <div className="faltgrupp">
        <label htmlFor="projekt-kod">Kod</label>
        <input
          id="projekt-kod"
          className="falt"
          autoComplete="off"
          placeholder="LEADER-28"
          maxLength={LANGSTA_PROJEKTKOD}
          value={kod}
          onChange={(handelse) => setKod(handelse.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="projekt-namn">Namn</label>
        <input
          id="projekt-namn"
          className="falt"
          autoComplete="off"
          placeholder="Ny scen vid badplatsen"
          maxLength={LANGSTA_PROJEKTNAMN}
          value={namn}
          onChange={(handelse) => setNamn(handelse.target.value)}
        />
      </div>

      <button
        type="button"
        className="knapp knapp--primar"
        disabled={arbetar || kod.trim() === '' || namn.trim() === ''}
        data-testid="skapa-projekt"
        onClick={() =>
          void kor(async () => {
            await onSkapa({ kod, namn });
            setKod('');
            setNamn('');
            return `Projektet ${kod.trim()} är skapat.`;
          })
        }
      >
        Skapa projekt
      </button>

      <Uppgiftsstatus arbetar={arbetar} besked={besked} fel={fel} />
    </section>
  );
}
