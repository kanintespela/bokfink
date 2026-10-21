import { useState } from 'react';

import { formatKronor } from '../../domain/belopp/ore';
import type { Uuid } from '../../domain/id/uuidv7';
import type { Konto, Kontonummer } from '../../domain/konto/konto';
import type { Underlag } from '../../domain/underlag/underlag';
import type { Verifikatutkast } from '../../domain/verifikat/verifikat';
import { Tillbaka } from '../../ui/Tillbaka';
import { Underlagsvisning, type Visat } from '../../ui/Underlagsvisning';

interface Props {
  /** Oldest first, which is the order they should be dealt with in. */
  readonly utkast: readonly Verifikatutkast[];
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  /** The receipts linked to each draft, by the draft's id. */
  readonly underlag: ReadonlyMap<Uuid, readonly Underlag[]>;
  /** Object URLs for the stored files, by content address. */
  readonly underlagsbilder: ReadonlyMap<string, string>;
  /** Books the draft as it stands and says what number it got. */
  readonly onBokfor: (utkast: Verifikatutkast) => Promise<string>;
  /** Throws the draft away; its receipts go back to waiting. */
  readonly onKassera: (utkast: Verifikatutkast) => Promise<void>;
  readonly onTillbaka: () => void;
}

/**
 * Drafts waiting to be booked.
 *
 * A draft is a suggestion someone or something else wrote - today, the
 * assistant that reads a photographed receipt on another device. Hard rule
 * 10 is why this screen exists: nothing becomes bookkeeping until the person
 * looking at it has seen the receipt and the accounts side by side and
 * pressed the button.
 *
 * Every draft is shown open. Collapsing them would invite booking a row by
 * its description alone, and the accounts are what the review is for.
 */
export function Utkastlista({
  utkast,
  konton,
  underlag,
  underlagsbilder,
  onBokfor,
  onKassera,
  onTillbaka,
}: Props) {
  const [arbetar, setArbetar] = useState(false);
  const [besked, setBesked] = useState<string | undefined>();
  const [fel, setFel] = useState<{ id: Uuid; text: string } | undefined>();
  const [bekraftar, setBekraftar] = useState<Uuid | undefined>();
  const [visar, setVisar] = useState<Visat | undefined>();

  async function kor(id: Uuid, uppgift: () => Promise<string>) {
    setArbetar(true);
    setBesked(undefined);
    setFel(undefined);
    try {
      setBesked(await uppgift());
    } catch (orsak) {
      // Hard rule 11: a locked period or a missing year has to be said here.
      setFel({ id, text: orsak instanceof Error ? orsak.message : String(orsak) });
    } finally {
      setArbetar(false);
    }
  }

  return (
    <section aria-label="Utkast">
      <Tillbaka onTillbaka={onTillbaka} />
      {visar !== undefined && (
        <Underlagsvisning underlag={visar} onStang={() => setVisar(undefined)} />
      )}
      <h2>Utkast</h2>

      <p className="tomt">
        Förslag som ännu inte är bokförda. Jämför kvittot med konteringen och bokför,
        eller ta bort förslaget.
      </p>

      {besked !== undefined && (
        <p className="kort" role="status" data-testid="utkast-besked">
          {besked}
        </p>
      )}

      {utkast.length === 0 ? (
        <p className="tomt" data-testid="inga-utkast">
          Inga utkast väntar.
        </p>
      ) : (
        <div data-testid="utkastlista">
          {utkast.map((post) => {
            const bevis = underlag.get(post.id) ?? [];
            return (
              <article key={post.id} className="kort" data-testid={`utkast-${post.id}`}>
                <p>
                  <strong>
                    {post.beskrivning.length > 0 ? post.beskrivning : 'Utkast'}
                  </strong>
                  <br />
                  <span className="listrad__sekundar">{post.datum}</span>
                </p>

                {bevis.length === 0 ? (
                  <p className="hjalptext">Inget kvitto är kopplat till förslaget.</p>
                ) : (
                  <>
                    {bevis.map((fil) => {
                      const url = underlagsbilder.get(fil.sha256);
                      return (
                        <div
                          key={fil.id}
                          className="underlagskort"
                          style={{ marginBottom: 'var(--rum-3)' }}
                        >
                          {url !== undefined && fil.mime.startsWith('image/') ? (
                            <img src={url} alt={`Underlag ${fil.filnamn}`} />
                          ) : (
                            <span className="underlagskort__symbol" aria-hidden="true">
                              PDF
                            </span>
                          )}
                          <span className="listrad__text">
                            <span className="listrad__sekundar">{fil.filnamn}</span>
                            {url === undefined ? (
                              <span className="listrad__sekundar">
                                Filen finns inte på den här enheten än.
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="knapp knapp--text"
                                onClick={() =>
                                  setVisar({
                                    url,
                                    mime: fil.mime,
                                    filnamn: fil.filnamn,
                                  })
                                }
                              >
                                Öppna
                              </button>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </>
                )}

                <ul
                  className="lista"
                  style={{ marginBottom: 'var(--rum-4)' }}
                  data-testid={`utkast-kontering-${post.id}`}
                >
                  {post.konteringar.map((rad, index) => (
                    <li key={`${rad.konto}-${index}`}>
                      <div
                        className={`listrad listrad--${rad.belopp < 0 ? 'kredit' : 'debet'}`}
                      >
                        <span className="listrad__text">
                          <span>{rad.konto}</span>
                          <span className="listrad__sekundar">
                            {konton.get(rad.konto)?.namn ??
                              'Kontot finns inte i kontoplanen'}
                          </span>
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

                {fel?.id === post.id && (
                  <p role="alert" data-testid={`utkast-fel-${post.id}`}>
                    {fel.text}
                  </p>
                )}

                <p>
                  <button
                    type="button"
                    className="knapp knapp--primar"
                    disabled={arbetar}
                    data-testid={`bokfor-utkast-${post.id}`}
                    onClick={() => void kor(post.id, () => onBokfor(post))}
                  >
                    Bokför
                  </button>
                </p>

                {bekraftar === post.id ? (
                  <>
                    <p className="hjalptext">
                      Ta bort förslaget?{' '}
                      {bevis.length > 0 &&
                        'Kvittot sparas och hamnar bland kvitton som väntar.'}
                    </p>
                    <button
                      type="button"
                      className="knapp knapp--text"
                      disabled={arbetar}
                      data-testid={`bekrafta-kassera-${post.id}`}
                      onClick={() => {
                        setBekraftar(undefined);
                        void kor(post.id, async () => {
                          await onKassera(post);
                          return 'Förslaget togs bort.';
                        });
                      }}
                    >
                      Ja, ta bort
                    </button>
                    <button
                      type="button"
                      className="knapp knapp--text"
                      onClick={() => setBekraftar(undefined)}
                    >
                      Avbryt
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="knapp knapp--text"
                    data-testid={`kassera-${post.id}`}
                    onClick={() => setBekraftar(post.id)}
                  >
                    Ta bort förslaget
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
