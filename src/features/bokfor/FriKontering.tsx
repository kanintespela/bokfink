import { useMemo, useState } from 'react';

import {
  formatKronor,
  isZero,
  kronorString,
  negate,
  type Ore,
} from '../../domain/belopp/ore';
import type { Uuid } from '../../domain/id/uuidv7';
import { kontonummer, type Konto, type Kontonummer } from '../../domain/konto/konto';
import { sokKonton } from '../../domain/konto/kontosok';
import type { Projekt } from '../../domain/projekt/projekt';
import type { Datum } from '../../domain/tid/datum';
import type { Underlag } from '../../domain/underlag/underlag';
import {
  friaKonteringar,
  summeraFriaRader,
  type Friarad,
} from '../../domain/verifikat/frikontering';
import type { Kontering } from '../../domain/verifikat/verifikat';
import { Tillbaka } from '../../ui/Tillbaka';
import { tolkaBelopp } from './Beloppsfalt';
import { Projektval } from './Projektval';

/** A booking from the questions, carried over to be changed here. */
export interface Friforslag {
  readonly datum: Datum;
  readonly beskrivning: string;
  readonly konteringar: readonly Kontering[];
  /** The leaf it came from, so its use is still counted. */
  readonly mall?: Uuid;
}

interface Props {
  readonly idag: Datum;
  /** Rows to start from instead of two empty ones. */
  readonly start?: Friforslag;
  /** The receipt to attach from the start, when the booking had one. */
  readonly forvaltUnderlag?: Uuid;
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  /** The projects a row can be booked on. A finished one is offered only where a row already has it. */
  readonly projekt: readonly Projekt[];
  /** Receipts waiting to be booked, any of which may be attached. */
  readonly kvitton: readonly Underlag[];
  readonly onBokfor: (val: {
    readonly datum: Datum;
    readonly beskrivning: string;
    readonly konteringar: readonly Kontering[];
    readonly underlagId: Uuid | undefined;
    readonly mall: Uuid | undefined;
  }) => Promise<string>;
  readonly onTillbaka: () => void;
  /**
   * Used for changing a draft rather than booking: the heading, the text
   * under it and the button say so. The form is the same - accounts,
   * debet, kredit, a balance that has to hold - because a draft that cannot
   * be booked is no better than none.
   */
  readonly redigering?: {
    readonly rubrik: string;
    readonly inledning: string;
    readonly knapp: string;
  };
}

interface Radtext {
  readonly konto: string;
  readonly debet: string;
  readonly kredit: string;
  readonly projekt: Uuid | '';
}

const TOM: Radtext = { konto: '', debet: '', kredit: '', projekt: '' };

/** Enough to choose from on a phone without the keyboard hiding the rest. */
const FORSLAG = 6;

/**
 * A verifikat with the accounts chosen by hand.
 *
 * For what no template can book: a receipt with two VAT rates, the payment
 * of a quarter's moms, a purchase of inventarier, interest, insurance. It
 * asks for more than the template form does - accounts and both sides - and
 * says at every step whether what is typed adds up, because the button stays
 * off until it does (hard rule 4).
 */
export function FriKontering({
  idag,
  start,
  forvaltUnderlag,
  konton,
  projekt,
  kvitton,
  onBokfor,
  onTillbaka,
  redigering,
}: Props) {
  const [datum, setDatum] = useState<string>(start?.datum ?? idag);
  const [beskrivning, setBeskrivning] = useState(start?.beskrivning ?? '');
  const [rader, setRader] = useState<readonly Radtext[]>(
    start === undefined ? [TOM, TOM] : start.konteringar.map(tillRadtext),
  );
  const [mall, setMall] = useState<Uuid | undefined>(start?.mall);
  const [underlagId, setUnderlagId] = useState<Uuid | ''>(
    forvaltUnderlag !== undefined &&
      kvitton.some((kvitto) => kvitto.id === forvaltUnderlag)
      ? forvaltUnderlag
      : '',
  );
  const [arbetar, setArbetar] = useState(false);
  const [besked, setBesked] = useState<string | undefined>();
  const [fel, setFel] = useState<string | undefined>();

  const aktiva = useMemo(
    () =>
      [...konton.values()]
        .filter((konto) => konto.aktiv)
        .sort((a, b) => a.nummer.localeCompare(b.nummer)),
    [konton],
  );

  const tolkade: readonly Friarad[] = rader.map(tolkaRad);
  const summa = summeraFriaRader(tolkade);

  // Why the button is off, in words, or undefined when it may be pressed.
  const hinder = (() => {
    if (beskrivning.trim() === '') {
      return 'Skriv vad verifikatet avser.';
    }
    const okandaKonton = tolkade.filter(
      (rad) => rad.konto !== undefined && !konton.has(rad.konto),
    );
    if (okandaKonton.length > 0) {
      return `Konto ${okandaKonton[0]!.konto} finns inte i kontoplanen.`;
    }
    let konteringar: Kontering[];
    try {
      konteringar = friaKonteringar(tolkade);
    } catch (orsak) {
      return orsak instanceof Error ? orsak.message : String(orsak);
    }
    if (konteringar.length < 2) {
      return 'Ett verifikat behöver minst två rader.';
    }
    if (!isZero(summa.skillnad)) {
      return `Debet och kredit skiljer ${formatKronor(summa.skillnad)} kr.`;
    }
    return undefined;
  })();

  function andraRad(index: number, andring: Partial<Radtext>) {
    setRader((forra) =>
      forra.map((rad, plats) => (plats === index ? { ...rad, ...andring } : rad)),
    );
  }

  async function bokfor() {
    setArbetar(true);
    setBesked(undefined);
    setFel(undefined);
    try {
      const svar = await onBokfor({
        datum: datum as Datum,
        beskrivning: beskrivning.trim(),
        konteringar: friaKonteringar(tolkade),
        underlagId: underlagId === '' ? undefined : underlagId,
        mall,
      });
      setBesked(svar);
      setBeskrivning('');
      setRader([TOM, TOM]);
      setUnderlagId('');
      setMall(undefined);
    } catch (orsak) {
      // Hard rule 11: a locked period or a future date is said here.
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setArbetar(false);
    }
  }

  return (
    <section aria-label="Fri kontering">
      <Tillbaka onTillbaka={onTillbaka} />
      <h2>{redigering?.rubrik ?? 'Fri kontering'}</h2>

      <p className="hjalptext">
        {redigering?.inledning ??
          'För det som frågorna inte passar för, eller för att ändra en kontering de ' +
            'föreslagit.'}{' '}
        Sök fram kontona på nummer eller namn och skriv beloppen på debet- eller
        kreditsidan – de två sidorna måste bli lika stora.
      </p>

      <div className="faltgrupp">
        <label htmlFor="fri-datum">Datum</label>
        <input
          id="fri-datum"
          className="falt"
          type="date"
          max={idag}
          value={datum}
          onChange={(handelse) => setDatum(handelse.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="fri-beskrivning">Vad avser det?</label>
        <input
          id="fri-beskrivning"
          className="falt"
          value={beskrivning}
          onChange={(handelse) => setBeskrivning(handelse.target.value)}
        />
      </div>

      <ol
        className="lista"
        data-testid="fria-rader"
        style={{ marginBottom: 'var(--rum-3)' }}
      >
        {rader.map((rad, index) => {
          const tolkad = tolkade[index]!;
          const konto = tolkad.konto === undefined ? undefined : konton.get(tolkad.konto);
          // An account already chosen needs no suggestions, nor does one the
          // kontoplan lacks: a full number is said to be missing instead.
          const forslag =
            konto === undefined && tolkad.konto === undefined
              ? sokKonton(aktiva, rad.konto).slice(0, FORSLAG)
              : [];
          return (
            <li key={index} style={{ padding: 'var(--rum-3) var(--rum-4)' }}>
              <div className="faltgrupp">
                <label htmlFor={`fri-konto-${index}`}>Konto, rad {index + 1}</label>
                <input
                  id={`fri-konto-${index}`}
                  className="falt"
                  type="search"
                  autoComplete="off"
                  placeholder="Nummer eller namn, t.ex. ingående moms"
                  value={rad.konto}
                  onChange={(handelse) =>
                    andraRad(index, { konto: handelse.target.value })
                  }
                />
                <span className="listrad__sekundar">
                  {rad.konto.trim() === ''
                    ? ' '
                    : (konto?.namn ??
                      (tolkad.konto !== undefined
                        ? 'Kontot finns inte i kontoplanen.'
                        : forslag.length === 0
                          ? `Inget konto matchar ”${rad.konto.trim()}”.`
                          : 'Välj ett konto:'))}
                </span>
              </div>
              {forslag.length > 0 && (
                <ul
                  className="lista"
                  data-testid={`kontoforslag-${index}`}
                  style={{ marginBottom: 'var(--rum-3)' }}
                >
                  {forslag.map((forslaget) => (
                    <li key={forslaget.nummer}>
                      <button
                        type="button"
                        className="listrad"
                        onClick={() => andraRad(index, { konto: forslaget.nummer })}
                      >
                        <span className="listrad__text">
                          <span>
                            {forslaget.nummer} {forslaget.namn}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'var(--rum-3)',
                }}
              >
                <div className="faltgrupp">
                  <label htmlFor={`fri-debet-${index}`}>Debet, rad {index + 1}</label>
                  <input
                    id={`fri-debet-${index}`}
                    className="falt"
                    inputMode="decimal"
                    value={rad.debet}
                    onChange={(handelse) =>
                      andraRad(index, { debet: handelse.target.value })
                    }
                  />
                </div>
                <div className="faltgrupp">
                  <label htmlFor={`fri-kredit-${index}`}>Kredit, rad {index + 1}</label>
                  <input
                    id={`fri-kredit-${index}`}
                    className="falt"
                    inputMode="decimal"
                    value={rad.kredit}
                    onChange={(handelse) =>
                      andraRad(index, { kredit: handelse.target.value })
                    }
                  />
                </div>
              </div>
              <Projektval
                id={`fri-projekt-${index}`}
                etikett={`Projekt, rad ${index + 1}`}
                projekt={projekt}
                varde={rad.projekt}
                onAndra={(valt) => andraRad(index, { projekt: valt })}
              />
              {rader.length > 2 && (
                <button
                  type="button"
                  className="knapp knapp--text"
                  onClick={() =>
                    setRader((forra) => forra.filter((_, plats) => plats !== index))
                  }
                >
                  Ta bort rad {index + 1}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      <p>
        <button
          type="button"
          className="knapp knapp--text"
          data-testid="lagg-till-rad"
          onClick={() => setRader((forra) => [...forra, TOM])}
        >
          Lägg till rad
        </button>
      </p>

      <p className="kort" data-testid="fri-summa">
        Debet {formatKronor(summa.debet)} kr · Kredit {formatKronor(summa.kredit)} kr
        {!isZero(summa.skillnad) && ` · skiljer ${formatKronor(summa.skillnad)} kr`}
      </p>

      {kvitton.length > 0 && (
        <div className="faltgrupp">
          <label htmlFor="fri-kvitto">Koppla ett kvitto som väntar</label>
          <select
            id="fri-kvitto"
            className="falt"
            value={underlagId}
            onChange={(handelse) => setUnderlagId(handelse.target.value as Uuid | '')}
          >
            <option value="">Inget kvitto</option>
            {kvitton.map((kvitto) => (
              <option key={kvitto.id} value={kvitto.id}>
                {kvitto.filnamn} ({kvitto.tillagd.slice(0, 10)})
              </option>
            ))}
          </select>
        </div>
      )}

      {hinder !== undefined && (
        <p className="hjalptext" data-testid="fri-hinder">
          {hinder}
        </p>
      )}

      <button
        type="button"
        className="knapp knapp--primar"
        disabled={arbetar || hinder !== undefined}
        data-testid="bokfor-fri"
        onClick={() => void bokfor()}
      >
        {redigering?.knapp ?? 'Bokför'}
      </button>

      {besked !== undefined && (
        <p className="kort" role="status" data-testid="fri-besked">
          {besked}
        </p>
      )}
      {fel !== undefined && (
        <p role="alert" data-testid="fri-fel">
          {fel}
        </p>
      )}
    </section>
  );
}

function tolkaRad(rad: Radtext): Friarad {
  const nummer = rad.konto.trim();
  let konto: Kontonummer | undefined;
  try {
    konto = nummer === '' ? undefined : kontonummer(nummer);
  } catch {
    konto = undefined;
  }
  const debet = tolkaBelopp(rad.debet);
  const kredit = tolkaBelopp(rad.kredit);
  return {
    ...(konto === undefined ? {} : { konto }),
    ...(debet === undefined ? {} : { debet }),
    ...(kredit === undefined ? {} : { kredit }),
    ...(rad.projekt === '' ? {} : { projekt: rad.projekt }),
  };
}

/** A proposed row as the fields hold it, on the side its sign says. */
function tillRadtext(rad: Kontering): Radtext {
  const kronor = (belopp: Ore) => kronorString(belopp).replace('.', ',');
  const projekt = rad.projekt ?? '';
  return rad.belopp < 0
    ? { konto: rad.konto, debet: '', kredit: kronor(negate(rad.belopp)), projekt }
    : { konto: rad.konto, debet: kronor(rad.belopp), kredit: '', projekt };
}
