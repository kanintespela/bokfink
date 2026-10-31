import { useMemo, useState } from 'react';

import { formatKronor } from '../../domain/belopp/ore';
import type { Konto, Kontonummer } from '../../domain/konto/konto';
import type { Projekt } from '../../domain/projekt/projekt';
import { beteckning, omslutning } from '../../domain/verifikat/verifikat';
import type { Verifikatpost } from '../../data/bokforing';
import { verifikationslistaTabell } from '../../domain/export/tabeller';
import { Exportknappar } from '../rapport/Exportknappar';
import type { Uuid } from '../../domain/id/uuidv7';
import type { Underlag } from '../../domain/underlag/underlag';
import { omfattar, type Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import type { Datum } from '../../domain/tid/datum';
import type { Forberedelse } from '../../platform/bild';
import type { Kvittobild } from '../underlag/Kvitton';
import { LaggTillUnderlag } from './LaggTillUnderlag';
import { Underlagsvisning, type Visat } from '../../ui/Underlagsvisning';
import { useFilprefix } from '../../ui/bok';

interface Props {
  /** Every year's verifikat; the list shows one year at a time. */
  readonly poster: readonly Verifikatpost[];
  readonly rakenskapsar: readonly Rakenskapsar[];
  readonly idag: Datum;
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  /** Named on the rows that are booked on one. */
  readonly projekt: ReadonlyMap<Uuid, Projekt>;
  /** The evidence attached to each verifikat, by verifikat id. */
  readonly underlag: ReadonlyMap<Uuid, readonly Underlag[]>;
  /**
   * Object URLs for the stored files, by content address.
   *
   * Made and revoked by the caller, and missing for a file this device does
   * not have - which happens on a device that synced the bookkeeping before
   * the receipts caught up. The list says so rather than showing a gap.
   */
  readonly underlagsbilder: ReadonlyMap<string, string>;
  /** Receipts stored but not linked yet, offered when evidence is added. */
  readonly kvitton: readonly Kvittobild[];
  /** Stores a file as an unlinked underlag, the way Kvitton does. */
  readonly onSparaUnderlag: (fil: File, forberedelse?: Forberedelse) => Promise<Underlag>;
  /**
   * Links evidence to a booked verifikat.
   *
   * Allowed after booking because the link lives on the underlag and leaves
   * the posting untouched (hard rule 5).
   */
  readonly onKopplaUnderlag: (post: Verifikatpost, underlag: Underlag) => Promise<void>;
  /**
   * Reverses a booked verifikat, or reports why it cannot be.
   *
   * Undefined when there is no open period to put the reversal in, which the
   * list needs to know so it can say so rather than offer a button that
   * fails.
   */
  readonly annulleringsdatum: (post: Verifikatpost) => string | undefined;
  readonly onAnnullera: (post: Verifikatpost) => Promise<void>;
  /**
   * Corrects what a verifikat says, never what it does.
   *
   * Bokföringslagen 5 kap. 8 § allows a verifikation to be corrected as long
   * as when and by whom are recorded, so the description and the date are
   * editable and the posting is not. Rejects, with a reason to show, when a
   * date would leave the year or a filed momsdeklaration.
   */
  readonly onRatta: (
    post: Verifikatpost,
    andring: { beskrivning?: string; datum?: Datum },
  ) => Promise<void>;
}

/**
 * The verifikationslista.
 *
 * One row per verifikat with the figure a list has shown since long before
 * anyone printed one from a computer: the total of the debit side. The
 * posting itself opens on a tap, because most of the time the question is
 * "did I book that?" rather than "on which accounts?".
 */
export function Verifikatlista({
  poster: allaPoster,
  rakenskapsar,
  idag,
  konton,
  projekt,
  underlag,
  underlagsbilder,
  kvitton,
  onSparaUnderlag,
  onKopplaUnderlag,
  annulleringsdatum,
  onAnnullera,
  onRatta,
}: Props) {
  const filprefix = useFilprefix();
  const [fraga, setFraga] = useState('');
  /** Which verifikat is being corrected, and what it is being corrected to. */
  const [rattar, setRattar] = useState<Uuid | undefined>();
  const [rattadText, setRattadText] = useState('');
  const [rattatDatum, setRattatDatum] = useState('');
  const [rattelsefel, setRattelsefel] = useState<string | undefined>();
  /*
   * Two orders, which are two books.
   *
   * By number is the verifikationslista - the order things were entered, and
   * how a series is checked for gaps. By date is the dagbok, the
   * grundbokföring bokföringslagen 5 kap. 1 § asks for alongside the
   * systematic kind. Same records, and the only honest difference is the sort.
   */
  /*
   * One year at a time, as a verifikationslista is kept. Which one opens is
   * the year covering today - unless nothing is booked in it yet, which is
   * every January, when the list that matters is December's.
   */
  const [valtArId, setValtArId] = useState<Rakenskapsar['id'] | undefined>();
  const nyastForst = useMemo(
    () => [...rakenskapsar].sort((a, b) => b.start.localeCompare(a.start)),
    [rakenskapsar],
  );
  const harPoster = (ar: Rakenskapsar) =>
    allaPoster.some((post) => post.rakenskapsarId === ar.id);
  const idagsAr = nyastForst.find((ar) => omfattar(ar, idag));
  const aret =
    nyastForst.find((ar) => ar.id === valtArId) ??
    (idagsAr !== undefined && harPoster(idagsAr)
      ? idagsAr
      : (nyastForst.find(harPoster) ?? idagsAr ?? nyastForst[0]));
  const poster = useMemo(
    () => allaPoster.filter((post) => post.rakenskapsarId === aret?.id),
    [allaPoster, aret],
  );

  const [ordning, setOrdning] = useState<'nummer' | 'datum'>('nummer');
  const [oppet, setOppet] = useState<string | undefined>();
  const [bekraftar, setBekraftar] = useState<string | undefined>();
  const [arbetar, setArbetar] = useState(false);
  /** Which verifikat is having evidence attached. */
  const [laggerTill, setLaggerTill] = useState<Uuid | undefined>();
  const [visar, setVisar] = useState<Visat | undefined>();

  const traffar = useMemo(() => {
    const sokt = normalisera(fraga);
    const filtrerade =
      sokt.length === 0
        ? poster
        : poster.filter((post) => {
            const text = `${beteckning(post.verifikat)} ${post.verifikat.beskrivning}`;
            return normalisera(text).includes(sokt);
          });

    if (ordning === 'nummer') {
      return filtrerade;
    }
    return [...filtrerade].sort((a, b) =>
      a.verifikat.datum === b.verifikat.datum
        ? b.verifikat.nummer - a.verifikat.nummer
        : a.verifikat.datum < b.verifikat.datum
          ? 1
          : -1,
    );
  }, [poster, fraga, ordning]);

  return (
    <section aria-label="Verifikationslista">
      {visar !== undefined && (
        <Underlagsvisning underlag={visar} onStang={() => setVisar(undefined)} />
      )}
      <h2>{ordning === 'nummer' ? 'Verifikationslista' : 'Dagbok'}</h2>

      <div className="segment" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          aria-pressed={ordning === 'nummer'}
          onClick={() => setOrdning('nummer')}
        >
          Nummerordning
        </button>
        <button
          type="button"
          aria-pressed={ordning === 'datum'}
          onClick={() => setOrdning('datum')}
        >
          Datumordning
        </button>
      </div>

      {nyastForst.length > 1 && aret !== undefined && (
        <div className="faltgrupp">
          <label htmlFor="verifikatar">Räkenskapsår</label>
          <select
            id="verifikatar"
            className="falt"
            value={aret.id}
            onChange={(handelse) =>
              setValtArId(handelse.target.value as Rakenskapsar['id'])
            }
          >
            {nyastForst.map((ar) => (
              <option key={ar.id} value={ar.id}>
                {ar.start.slice(0, 4)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="faltgrupp">
        <label htmlFor="verifikatsok">Sök</label>
        <input
          id="verifikatsok"
          className="falt"
          type="search"
          autoComplete="off"
          placeholder="Nummer eller beskrivning"
          value={fraga}
          onChange={(handelse) => setFraga(handelse.target.value)}
        />
      </div>

      {poster.length > 0 && (
        <Exportknappar
          tabell={verifikationslistaTabell(
            poster.map((post) => post.verifikat),
            konton,
          )}
          namn={`${filprefix}-verifikationslista`}
        />
      )}

      {traffar.length === 0 ? (
        <p className="tomt" data-testid="inga-verifikat">
          {poster.length === 0
            ? 'Inget är bokfört ännu.'
            : `Inget verifikat matchar ”${fraga}”.`}
        </p>
      ) : (
        <ul className="lista" data-testid="verifikatlista">
          {traffar.map((post) => {
            const id = post.verifikat.id;
            const visas = oppet === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  className="listrad"
                  aria-expanded={visas}
                  onClick={() => setOppet(visas ? undefined : id)}
                >
                  <span className="listrad__text">
                    <span>
                      {beteckning(post.verifikat)}
                      {post.annulleratAv !== undefined && ' · annullerat'}
                      {post.verifikat.annullerar !== undefined && ' · annullering'}
                    </span>
                    <span className="listrad__sekundar">
                      {post.verifikat.datum}
                      {post.verifikat.beskrivning.length > 0 &&
                        ` · ${post.verifikat.beskrivning}`}
                    </span>
                  </span>
                  <span className="belopp">
                    {formatKronor(omslutning(post.verifikat))}
                  </span>
                </button>

                {visas && (
                  <>
                    {/*
                     * What was corrected, and when. BFL 5 kap. 8 § asks for
                     * the record; this is it, in the place a granskare looks.
                     */}
                    {(post.verifikat.rattelser ?? []).length > 0 && (
                      <ul className="lista" data-testid={`rattelser-${id}`}>
                        {(post.verifikat.rattelser ?? []).map((rattelse, index) => (
                          <li key={`${rattelse.nar}-${index}`}>
                            <span className="listrad__text">
                              <span className="listrad__sekundar">
                                {rattelse.falt === 'datum' ? 'Datum' : 'Beskrivning'}{' '}
                                rättad {rattelse.nar.slice(0, 10)}
                              </span>
                              <span className="listrad__sekundar">
                                ”{rattelse.fran}” → ”{rattelse.till}”
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {rattar === id ? (
                      <div className="kort" data-testid={`rattelseformular-${id}`}>
                        <div className="faltgrupp">
                          <label htmlFor={`rattad-text-${id}`}>Beskrivning</label>
                          <input
                            id={`rattad-text-${id}`}
                            className="falt"
                            type="text"
                            autoComplete="off"
                            value={rattadText}
                            onChange={(handelse) => setRattadText(handelse.target.value)}
                          />

                          <label htmlFor={`rattat-datum-${id}`}>Datum</label>
                          <input
                            id={`rattat-datum-${id}`}
                            className="falt"
                            type="date"
                            max={idag}
                            value={rattatDatum}
                            onChange={(handelse) => setRattatDatum(handelse.target.value)}
                          />
                        </div>

                        <p className="hjalptext">
                          Konteringen står kvar som den är. Det som rättas sparas med
                          datum, och originaltexten blir kvar här under.
                        </p>

                        {rattelsefel !== undefined && (
                          <p role="alert" data-testid={`rattelsefel-${id}`}>
                            {rattelsefel}
                          </p>
                        )}

                        <button
                          type="button"
                          className="knapp knapp--primar"
                          disabled={arbetar}
                          data-testid={`spara-rattelse-${id}`}
                          onClick={() => {
                            setArbetar(true);
                            setRattelsefel(undefined);
                            void onRatta(post, {
                              ...(rattadText.trim() === post.verifikat.beskrivning
                                ? {}
                                : { beskrivning: rattadText }),
                              ...(rattatDatum === post.verifikat.datum
                                ? {}
                                : { datum: rattatDatum as Datum }),
                            })
                              .then(() => setRattar(undefined))
                              // Hard rule 11: a refused correction says why.
                              .catch((orsak: unknown) =>
                                setRattelsefel(
                                  orsak instanceof Error ? orsak.message : String(orsak),
                                ),
                              )
                              .finally(() => setArbetar(false));
                          }}
                        >
                          Spara rättelsen
                        </button>
                        <button
                          type="button"
                          className="knapp knapp--text"
                          onClick={() => {
                            setRattar(undefined);
                            setRattelsefel(undefined);
                          }}
                        >
                          Avbryt
                        </button>
                      </div>
                    ) : (
                      bekraftar !== id && (
                        <button
                          type="button"
                          className="knapp knapp--text"
                          data-testid={`ratta-${id}`}
                          onClick={() => {
                            setRattar(id);
                            setRattelsefel(undefined);
                            setRattadText(post.verifikat.beskrivning);
                            setRattatDatum(post.verifikat.datum);
                          }}
                        >
                          Rätta text eller datum
                        </button>
                      )
                    )}

                    {annullerbar(post) &&
                      (bekraftar === id ? (
                        <div className="kort" data-testid={`bekrafta-${id}`}>
                          <p>
                            Konteringen kan inte ändras. Att annullera verifikatet skriver
                            spegelbilden{' '}
                            {annulleringsdatum(post) === undefined
                              ? ''
                              : `den ${annulleringsdatum(post)}`}
                            , så att de två tar ut varandra. Originalet står kvar.
                          </p>
                          {annulleringsdatum(post) === undefined ? (
                            <p role="alert">
                              Det finns ingen öppen period att bokföra annulleringen i.
                            </p>
                          ) : (
                            <button
                              type="button"
                              className="knapp knapp--primar"
                              disabled={arbetar}
                              data-testid={`annullera-${id}`}
                              onClick={() => {
                                setArbetar(true);
                                void onAnnullera(post).finally(() => {
                                  setArbetar(false);
                                  setBekraftar(undefined);
                                });
                              }}
                            >
                              Annullera {beteckning(post.verifikat)}
                            </button>
                          )}
                          <button
                            type="button"
                            className="knapp knapp--text"
                            onClick={() => setBekraftar(undefined)}
                          >
                            Avbryt
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="knapp knapp--text"
                          data-testid={`andra-${id}`}
                          onClick={() => setBekraftar(id)}
                        >
                          Ändra
                        </button>
                      ))}

                    {(underlag.get(id) ?? []).length > 0 && (
                      <ul className="lista" data-testid={`underlag-${id}`}>
                        {(underlag.get(id) ?? []).map((post) => {
                          const url = underlagsbilder.get(post.sha256);
                          return (
                            <li key={post.id} className="kort underlagskort">
                              {url !== undefined && post.mime.startsWith('image/') ? (
                                <img src={url} alt={`Underlag ${post.filnamn}`} />
                              ) : (
                                <span
                                  className="underlagskort__symbol"
                                  aria-hidden="true"
                                >
                                  PDF
                                </span>
                              )}

                              <span className="listrad__text">
                                <span className="listrad__sekundar">{post.filnamn}</span>

                                {url === undefined ? (
                                  <span className="listrad__sekundar">
                                    Filen finns inte på den här enheten än.
                                  </span>
                                ) : (
                                  /*
                                   * Shown inside the app. It was a link to the
                                   * blob URL in a new window, which from the
                                   * iPhone's home screen opened nothing.
                                   */
                                  <button
                                    type="button"
                                    className="knapp knapp--text"
                                    data-testid={`oppna-underlag-${post.id}`}
                                    onClick={() =>
                                      setVisar({
                                        url,
                                        mime: post.mime,
                                        filnamn: post.filnamn,
                                      })
                                    }
                                  >
                                    Öppna
                                  </button>
                                )}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {laggerTill === id ? (
                      <LaggTillUnderlag
                        beteckning={beteckning(post.verifikat)}
                        kvitton={kvitton}
                        kopplade={underlag.get(id) ?? []}
                        onSpara={onSparaUnderlag}
                        onKoppla={(valt) => onKopplaUnderlag(post, valt)}
                        onStang={() => setLaggerTill(undefined)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="knapp knapp--text"
                        data-testid={`lagg-till-underlag-${id}`}
                        onClick={() => setLaggerTill(id)}
                      >
                        Lägg till underlag
                      </button>
                    )}

                    <ul className="lista" data-testid={`kontering-${id}`}>
                      {post.verifikat.konteringar.map((rad, index) => (
                        <li key={`${rad.konto}-${index}`}>
                          <div
                            className={`listrad listrad--${rad.belopp < 0 ? 'kredit' : 'debet'}`}
                          >
                            <span className="listrad__text">
                              <span>{rad.konto}</span>
                              <span className="listrad__sekundar">
                                {konton.get(rad.konto)?.namn ?? ''}
                                {rad.projekt !== undefined &&
                                  ` · ${projekt.get(rad.projekt)?.kod ?? 'okänt projekt'}`}
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
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Only an ordinary verifikat can be reversed.
 *
 * One that already has been would be reversed twice, and an annulment that
 * is itself annulled puts the original back in force by a route nobody can
 * follow a year later.
 */
function annullerbar(post: Verifikatpost): boolean {
  return post.annulleratAv === undefined && post.verifikat.annullerar === undefined;
}

/** Folds case and accents, the same way template search does. */
function normalisera(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
