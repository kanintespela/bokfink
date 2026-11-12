import { useState } from 'react';

import { BOKPROFILNAMN } from '../../domain/bok/bokprofil';
import { Uppgiftsstatus, useUppgift } from '../data/uppgift';
import type { Serverbokrad } from '../synk/serverbocker';

interface Props {
  /** Whether the open book is logged in to a sync server. */
  readonly inloggad: boolean;
  /** The open book's identity, which is what the server knows it by. */
  readonly bokId: string;
  readonly onLista: () => Promise<readonly Serverbokrad[]>;
  /** Makes room for the book here and opens it. The passphrase is the one typed for a locked book. */
  readonly onHamta: (rad: Serverbokrad, losenfras: string | undefined) => Promise<void>;
}

/**
 * The books on the sync server, and the way to get one of them onto this
 * device.
 *
 * Uses the open book's login: the server is the owner's own, and every book
 * on it is reached with the same account. Nothing is listed until asked for,
 * since the list is a request to the server and this screen is also where
 * someone goes just to switch book.
 */
export function Serverbocker({ inloggad, bokId, onLista, onHamta }: Props) {
  const [rader, setRader] = useState<readonly Serverbokrad[] | undefined>();
  const [losenfraser, setLosenfraser] = useState<Readonly<Record<string, string>>>({});
  const { arbetar, besked, fel, kor } = useUppgift();

  return (
    <section aria-label="Böcker på servern">
      <h2>Hämta en bok från servern</h2>
      {!inloggad ? (
        <p className="hjalptext" data-testid="serverbocker-utloggad">
          En bok som synkas från en annan enhet kan hämtas hit. Logga först in mot servern
          under Mer, Synk mellan enheter, i boken som är öppen.
        </p>
      ) : (
        <>
          <p className="hjalptext">
            En bok som synkas från en annan enhet kan hämtas hit, så att du kan bokföra
            och läsa i den på båda. Den första boken hämtas inte här: logga in under Synk
            i den, på den här enheten.
          </p>
          <p>
            <button
              type="button"
              className="knapp"
              disabled={arbetar}
              data-testid="visa-serverbocker"
              onClick={() =>
                void kor(async () => {
                  const hamtade = await onLista();
                  setRader(hamtade);
                  return hamtade.length === 0
                    ? 'Servern har inga böcker än. En bok syns här när den har synkats en gång.'
                    : '';
                })
              }
            >
              {rader === undefined ? 'Visa böckerna på servern' : 'Läs listan igen'}
            </button>
          </p>

          {rader !== undefined && rader.length > 0 && (
            <ul className="lista" data-testid="serverbocker">
              {rader.map((rad) => (
                <li key={rad.id}>
                  <div className="listrad">
                    <span className="listrad__text">
                      <strong>
                        {rad.slag === 'lasbar' ? rad.beskrivning.namn : 'Krypterad bok'}
                      </strong>
                      <span className="hjalptext">
                        {rad.slag === 'lasbar' && BOKPROFILNAMN[rad.beskrivning.profil]}
                        {rad.slag === 'krypterad' &&
                          'Skriv bokens lösenfras för synken för att hämta den.'}
                        {rad.slag === 'olaslig' && rad.fel}
                      </span>
                    </span>
                    {rad.finnsHarSom !== undefined ? (
                      <span className="listrad__sekundar">
                        Finns här{rad.slag === 'lasbar' ? '' : ` som ${rad.finnsHarSom}`}
                      </span>
                    ) : (
                      rad.slag === 'lasbar' && (
                        <button
                          type="button"
                          className="knapp"
                          disabled={arbetar}
                          aria-label={`Hämta ${rad.beskrivning.namn}`}
                          onClick={() =>
                            void kor(async () => {
                              await onHamta(rad, undefined);
                              return `${rad.beskrivning.namn} är hämtad och öppnad.`;
                            })
                          }
                        >
                          Hämta
                        </button>
                      )
                    )}
                  </div>

                  {rad.slag === 'krypterad' && rad.finnsHarSom === undefined && (
                    <form
                      className="faltgrupp listrad__formular"
                      onSubmit={(handelse) => {
                        handelse.preventDefault();
                        void kor(async () => {
                          await onHamta(rad, (losenfraser[rad.id] ?? '').trim());
                          return 'Boken är hämtad och öppnad.';
                        });
                      }}
                    >
                      <label htmlFor={`serverbok-fras-${rad.id}`}>Bokens lösenfras</label>
                      <input
                        id={`serverbok-fras-${rad.id}`}
                        className="falt"
                        type="password"
                        autoComplete="off"
                        value={losenfraser[rad.id] ?? ''}
                        onChange={(handelse) =>
                          setLosenfraser({
                            ...losenfraser,
                            [rad.id]: handelse.target.value,
                          })
                        }
                      />
                      <button
                        type="submit"
                        className="knapp"
                        disabled={arbetar || (losenfraser[rad.id] ?? '').trim() === ''}
                      >
                        Hämta boken
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="hjalptext">
        Den öppna bokens identitet på servern är{' '}
        <code data-testid="bokens-identitet">{bokId}</code>. Den behövs bara om
        kvittoassistenten ska höra till just den här boken.
      </p>

      <Uppgiftsstatus
        arbetar={arbetar}
        besked={besked === '' ? undefined : besked}
        fel={fel}
      />
    </section>
  );
}
