import { useMemo, useState } from 'react';

import { formatKronor, type Ore } from '../../domain/belopp/ore';
import type { Uuid } from '../../domain/id/uuidv7';
import type { Konto, Kontonummer } from '../../domain/konto/konto';
import {
  kostnaderPerKonto,
  type Fordelningsriktning,
  type Kostnadsfordelning,
} from '../../domain/projekt/fordelning';
import type { Projekt } from '../../domain/projekt/projekt';
import type { Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import type { Datum } from '../../domain/tid/datum';
import type { BokfortVerifikat } from '../../domain/verifikat/verifikat';
import { Tillbaka } from '../../ui/Tillbaka';
import { tolkaBelopp } from '../bokfor/Beloppsfalt';
import { Uppgiftsstatus, useUppgift } from '../data/uppgift';

interface Props {
  readonly onTillbaka: () => void;
  readonly rakenskapsar: readonly Rakenskapsar[];
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly projekt: readonly Projekt[];
  /** Every year's verifikat. */
  readonly verifikat: readonly BokfortVerifikat[];
  readonly idag: Datum;
  /** Books the move and says what it was booked as. */
  readonly onFordela: (val: {
    readonly datum: Datum;
    readonly konto: Kontonummer;
    readonly belopp: Ore;
    readonly projekt: Uuid;
    readonly riktning: Fordelningsriktning;
    readonly beskrivning: string;
  }) => Promise<string>;
}

/**
 * Sharing out the common costs - electricity, rent, insurance - among projects.
 *
 * Lists the cost accounts of a year with what is on no project, and moves an
 * amount between "no project" and a project on the same account. The account
 * comes to what it did, so nothing in the accounts changes; the project's own
 * outcome does. How much a project is to carry is for the association to
 * decide, and the screen only books what is typed (hard rule 10).
 */
export function Fordelningssida({
  onTillbaka,
  rakenskapsar,
  konton,
  projekt,
  verifikat,
  idag,
  onFordela,
}: Props) {
  const aren = useMemo(
    () => [...rakenskapsar].sort((a, b) => b.start.localeCompare(a.start)),
    [rakenskapsar],
  );
  const [arId, setArId] = useState<Uuid | undefined>(
    (aren.find((ar) => idag >= ar.start && idag <= ar.slut) ?? aren[0])?.id,
  );
  const ar = aren.find((kandidat) => kandidat.id === arId) ?? aren[0];
  const oppna = projekt.filter((post) => !post.avslutat);

  const poster = useMemo(
    () =>
      ar === undefined
        ? []
        : kostnaderPerKonto(verifikat, { start: ar.start, slut: ar.slut }),
    [verifikat, ar],
  );

  /** The account being shared out, and what is typed for it. */
  const [valt, setValt] = useState<Kontonummer | undefined>();
  const [projektId, setProjektId] = useState<Uuid | ''>('');
  const [riktning, setRiktning] = useState<Fordelningsriktning>('till_projekt');
  const [beloppText, setBeloppText] = useState('');
  const [datumText, setDatumText] = useState('');
  const [beskrivning, setBeskrivning] = useState('');
  const { arbetar, besked, fel, kor } = useUppgift();

  if (ar === undefined) {
    return (
      <section aria-label="Fördela kostnader på projekt">
        <Tillbaka onTillbaka={onTillbaka} />
        <h2>Fördela kostnader på projekt</h2>
        <p className="tomt" data-testid="fordela-inget-ar">
          Lägg upp ett räkenskapsår först.
        </p>
      </section>
    );
  }

  const namn = (konto: Kontonummer) => konton.get(konto)?.namn ?? '';
  const post: Kostnadsfordelning | undefined = poster.find((p) => p.konto === valt);
  const valtProjekt = oppna.find((p) => p.id === projektId);
  const belopp = tolkaBelopp(beloppText);
  const sistaDag = idag < ar.slut ? idag : ar.slut;

  // How much there is to move: the common cost one way, the project's own the other.
  const tillgangligt =
    post === undefined
      ? undefined
      : riktning === 'till_projekt'
        ? post.utanProjekt
        : projektId === ''
          ? undefined
          : (post.perProjekt.get(projektId) ?? (0 as Ore));

  const hinder = (() => {
    if (post === undefined) {
      return undefined;
    }
    if (valtProjekt === undefined) {
      return 'Välj ett projekt.';
    }
    if (belopp === undefined || belopp <= 0) {
      return 'Skriv beloppet som ska flyttas.';
    }
    if (tillgangligt !== undefined && belopp > tillgangligt) {
      return riktning === 'till_projekt'
        ? `Det är mer än de ${formatKronor(post.utanProjekt)} kr på kontot som inte hör till något projekt.`
        : `Det är mer än de ${formatKronor(tillgangligt)} kr som ${valtProjekt.kod} har på kontot.`;
    }
    if (beskrivning.trim() === '') {
      return 'Skriv vad det gäller.';
    }
    if (datumText < ar.start || datumText > sistaDag) {
      return `Datumet måste ligga mellan ${ar.start} och ${sistaDag}.`;
    }
    return undefined;
  })();

  function oppnaFordelning(konto: Kontonummer) {
    setValt(konto);
    setProjektId(oppna[0]?.id ?? '');
    setRiktning('till_projekt');
    setBeloppText('');
    setDatumText(sistaDag);
    setBeskrivning(`Fördelning av ${konto} ${namn(konto)}`.trim());
  }

  return (
    <section aria-label="Fördela kostnader på projekt">
      <Tillbaka onTillbaka={onTillbaka} />
      <h2>Fördela kostnader på projekt</h2>
      <p className="hjalptext">
        Kostnader som inte hör till något projekt, till exempel el, hyra och försäkring,
        kan delas ut på projekten. Det flyttar bara kostnaden mellan ”inget projekt” och
        ett projekt på samma konto: kontots belopp är detsamma, men projektets kostnad
        ändras. Hur mycket ett projekt ska bära bestämmer ni själva.
      </p>

      {oppna.length === 0 ? (
        <p className="tomt" data-testid="fordela-inga-projekt">
          Det finns inget pågående projekt att fördela på. Lägg upp ett under Mer,
          Projekt.
        </p>
      ) : (
        <>
          {aren.length > 1 && (
            <div className="faltgrupp">
              <label htmlFor="fordela-ar">Räkenskapsår</label>
              <select
                id="fordela-ar"
                className="falt"
                value={ar.id}
                onChange={(handelse) => {
                  setArId(handelse.target.value as Uuid);
                  setValt(undefined);
                }}
              >
                {aren.map((kandidat) => (
                  <option key={kandidat.id} value={kandidat.id}>
                    {kandidat.start.slice(0, 4)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {poster.length === 0 ? (
            <p className="tomt" data-testid="fordela-inga-kostnader">
              Inga kostnader är bokförda det här året.
            </p>
          ) : (
            <ul className="lista" data-testid="kostnader-per-konto">
              {poster.map((kostnad) => (
                <li key={kostnad.konto}>
                  <div className="listrad">
                    <span className="listrad__text">
                      <span>
                        {kostnad.konto} {namn(kostnad.konto)}
                      </span>
                      <span className="listrad__sekundar">
                        Totalt {formatKronor(kostnad.totalt)} · på projekt{' '}
                        {formatKronor(kostnad.medProjekt)} · inget projekt{' '}
                        <strong>{formatKronor(kostnad.utanProjekt)}</strong>
                      </span>
                    </span>
                    <button
                      type="button"
                      className="knapp knapp--text"
                      aria-expanded={valt === kostnad.konto}
                      data-testid={`fordela-${kostnad.konto}`}
                      onClick={() =>
                        valt === kostnad.konto
                          ? setValt(undefined)
                          : oppnaFordelning(kostnad.konto)
                      }
                    >
                      Fördela
                    </button>
                  </div>

                  {valt === kostnad.konto && (
                    <div className="kort" data-testid="fordelningsformular">
                      <div className="faltgrupp">
                        <label htmlFor="fordela-riktning">Flytta</label>
                        <select
                          id="fordela-riktning"
                          className="falt"
                          value={riktning}
                          onChange={(handelse) =>
                            setRiktning(handelse.target.value as Fordelningsriktning)
                          }
                        >
                          <option value="till_projekt">
                            Från inget projekt till ett projekt
                          </option>
                          <option value="fran_projekt">
                            Från ett projekt tillbaka till inget projekt
                          </option>
                        </select>
                      </div>

                      <div className="faltgrupp">
                        <label htmlFor="fordela-projekt">Projekt</label>
                        <select
                          id="fordela-projekt"
                          className="falt"
                          value={projektId}
                          onChange={(handelse) =>
                            setProjektId(handelse.target.value as Uuid)
                          }
                        >
                          {oppna.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.kod} {p.namn}
                            </option>
                          ))}
                        </select>
                        {tillgangligt !== undefined && (
                          <span
                            className="listrad__sekundar"
                            data-testid="fordela-tillgangligt"
                          >
                            Går att flytta: {formatKronor(tillgangligt)} kr
                          </span>
                        )}
                      </div>

                      <div className="faltgrupp">
                        <label htmlFor="fordela-belopp">Belopp</label>
                        <input
                          id="fordela-belopp"
                          className="falt"
                          inputMode="decimal"
                          value={beloppText}
                          onChange={(handelse) => setBeloppText(handelse.target.value)}
                        />
                      </div>

                      <div className="faltgrupp">
                        <label htmlFor="fordela-datum">Datum</label>
                        <input
                          id="fordela-datum"
                          className="falt"
                          type="date"
                          min={ar.start}
                          max={sistaDag}
                          value={datumText}
                          onChange={(handelse) => setDatumText(handelse.target.value)}
                        />
                      </div>

                      <div className="faltgrupp">
                        <label htmlFor="fordela-beskrivning">Vad gäller det?</label>
                        <input
                          id="fordela-beskrivning"
                          className="falt"
                          value={beskrivning}
                          onChange={(handelse) => setBeskrivning(handelse.target.value)}
                        />
                      </div>

                      {hinder !== undefined && (
                        <p className="hjalptext" data-testid="fordela-hinder">
                          {hinder}
                        </p>
                      )}

                      <button
                        type="button"
                        className="knapp knapp--primar"
                        disabled={arbetar || hinder !== undefined}
                        data-testid="bokfor-fordelning"
                        onClick={() =>
                          void kor(async () => {
                            if (belopp === undefined || valtProjekt === undefined) {
                              throw new TypeError('Beloppet eller projektet saknas.');
                            }
                            const svar = await onFordela({
                              datum: datumText as Datum,
                              konto: kostnad.konto,
                              belopp,
                              projekt: valtProjekt.id,
                              riktning,
                              beskrivning: beskrivning.trim(),
                            });
                            setValt(undefined);
                            return svar;
                          })
                        }
                      >
                        Bokför fördelningen
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Uppgiftsstatus arbetar={arbetar} besked={besked} fel={fel} />
    </section>
  );
}
