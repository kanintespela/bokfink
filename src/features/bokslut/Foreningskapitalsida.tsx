import { useEffect, useState } from 'react';

import { formatKronor, oreFromKronor, type Ore } from '../../domain/belopp/ore';
import {
  FORSTA_RESERVERINGSKONTO,
  SISTA_RESERVERINGSKONTO,
  type Foreningskapital,
  type Reserveringsriktning,
} from '../../domain/bokslut/foreningskapital';
import { kontonummer, type Konto, type Kontonummer } from '../../domain/konto/konto';
import type { Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import type { Datum } from '../../domain/tid/datum';
import { Tillbaka } from '../../ui/Tillbaka';

interface Props {
  readonly onTillbaka: () => void;
  readonly rakenskapsar: readonly Rakenskapsar[];
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly idag: Datum;
  readonly onHamta: (ar: Rakenskapsar) => Promise<Foreningskapital>;
  readonly onBokfor: (uppgifter: {
    readonly datum: Datum;
    readonly konto: Kontonummer;
    readonly namn: string;
    readonly belopp: Ore;
    readonly riktning: Reserveringsriktning;
  }) => Promise<string>;
}

/**
 * The association's eget kapital, and the funds set aside inside it.
 *
 * Bilaga 2 of BFNAR 2010:1 has two lines under eget kapital, balanserat and
 * årets över-/underskott. Reserved funds (punkt 6.67) are part of the first,
 * so they are shown here as a split of it rather than as a third kind of
 * capital. Setting funds aside is the association's own decision; this page
 * books it and checks that the books add up, and does not decide what a
 * purpose is or how much to set aside.
 */
export function Foreningskapitalsida({
  onTillbaka,
  rakenskapsar,
  konton,
  idag,
  onHamta,
  onBokfor,
}: Props) {
  const [arId, setArId] = useState<string>(rakenskapsar[0]?.id ?? '');
  const [kapital, setKapital] = useState<Foreningskapital | undefined>();
  const [riktning, setRiktning] = useState<Reserveringsriktning>('reservera');
  const [kontoText, setKontoText] = useState('');
  const [namn, setNamn] = useState('');
  const [beloppText, setBeloppText] = useState('');
  const [datum, setDatum] = useState(idag);
  const [arbetar, setArbetar] = useState(false);
  const [besked, setBesked] = useState<string | undefined>();
  const [fel, setFel] = useState<string | undefined>();

  const valtAr = rakenskapsar.find((kandidat) => kandidat.id === arId);

  /** Bumped when something was booked, so the figures are read again. */
  const [uppdatering, setUppdatering] = useState(0);

  useEffect(() => {
    if (valtAr === undefined) {
      return undefined;
    }
    let avbruten = false;
    onHamta(valtAr).then(
      (hamtat) => {
        if (!avbruten) {
          setKapital(hamtat);
        }
      },
      (orsak: unknown) => {
        // Hard rule 11: shown, not swallowed.
        if (!avbruten) {
          setFel(orsak instanceof Error ? orsak.message : String(orsak));
        }
      },
    );
    return () => {
      avbruten = true;
    };
  }, [valtAr, onHamta, uppdatering]);

  async function kor(uppgift: () => Promise<string>) {
    setArbetar(true);
    setBesked(undefined);
    setFel(undefined);
    try {
      setBesked(await uppgift());
    } catch (orsak) {
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setArbetar(false);
    }
  }

  const beloppOre = (() => {
    try {
      return beloppText.trim() === '' ? undefined : oreFromKronor(beloppText);
    } catch {
      return undefined;
    }
  })();

  const kontoNummer = (() => {
    try {
      return kontoText.trim() === '' ? undefined : kontonummer(kontoText.trim());
    } catch {
      return undefined;
    }
  })();
  const befintligt = kontoNummer === undefined ? undefined : konton.get(kontoNummer);

  /** Funds set aside already, which are what can be freed. */
  const reserverade = kapital?.reserverade ?? [];

  return (
    <section aria-label="Eget kapital">
      <Tillbaka onTillbaka={onTillbaka} />
      <h2>Eget kapital</h2>

      <div className="faltgrupp">
        <label htmlFor="foreningskapital-ar">Räkenskapsår</label>
        <select
          id="foreningskapital-ar"
          className="falt"
          value={arId}
          onChange={(handelse) => {
            setArId(handelse.target.value);
            setKapital(undefined);
          }}
        >
          {rakenskapsar.map((kandidat) => (
            <option key={kandidat.id} value={kandidat.id}>
              {kandidat.start.slice(0, 4)}
            </option>
          ))}
        </select>
      </div>

      {kapital !== undefined && (
        <>
          <dl data-testid="foreningskapital">
            <dt>Ingående eget kapital</dt>
            <dd>{formatKronor(kapital.ingaende)}</dd>
            <dt>Årets över-/underskott hittills</dt>
            <dd>{formatKronor(kapital.aretsResultat)}</dd>
            <dt>Utgående eget kapital</dt>
            <dd>{formatKronor(kapital.utgaende)}</dd>
          </dl>
          <p className="hjalptext">
            Det balanserade kapitalet, före årets resultat, är{' '}
            <strong>{formatKronor(kapital.balanserat)}</strong>.
          </p>

          <h3>Reserverade medel för ändamål</h3>
          {reserverade.length === 0 ? (
            <p className="tomt" data-testid="inga-reserverade">
              Inga medel är reserverade för något ändamål.
            </p>
          ) : (
            <ul className="lista" data-testid="reserverade-medel">
              {reserverade.map((post) => (
                <li key={post.konto}>
                  <span className="listrad">
                    <span className="listrad__text">
                      <span>
                        {post.konto} {konton.get(post.konto)?.namn ?? ''}
                      </span>
                      <span className="listrad__sekundar">
                        Ingående {formatKronor(post.ingaende)}
                      </span>
                    </span>
                    <span>{formatKronor(post.utgaende)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <dl>
            <dt>Reserverat</dt>
            <dd data-testid="summa-reserverat">
              {formatKronor(kapital.summaReserverat)}
            </dd>
            <dt>Ej reserverat</dt>
            <dd data-testid="fritt-kapital">{formatKronor(kapital.fritt)}</dd>
          </dl>
        </>
      )}

      <p className="hjalptext">
        Medel som föreningen har satt av för ett särskilt ändamål är en del av eget
        kapital. Att reservera eller frigöra dem flyttar bara kapital inom eget kapital
        och påverkar inte resultatet (BFNAR 2010:1 punkt 6.67). Vad föreningen reserverar,
        och hur mycket, avgör den själv, till exempel på årsmötet; Bokfink bokför det du
        anger.
      </p>

      <h3>Reservera eller frigör medel</h3>

      <div className="segment">
        <button
          type="button"
          aria-pressed={riktning === 'reservera'}
          onClick={() => setRiktning('reservera')}
        >
          Reservera
        </button>
        <button
          type="button"
          aria-pressed={riktning === 'frigor'}
          onClick={() => setRiktning('frigor')}
        >
          Frigör
        </button>
      </div>

      <div className="faltgrupp">
        <label htmlFor="foreningskapital-konto">
          Konto för ändamålet ({FORSTA_RESERVERINGSKONTO}–{SISTA_RESERVERINGSKONTO})
        </label>
        <input
          id="foreningskapital-konto"
          className="falt"
          inputMode="numeric"
          autoComplete="off"
          list="foreningskapital-konton"
          value={kontoText}
          onChange={(handelse) => setKontoText(handelse.target.value)}
        />
        <datalist id="foreningskapital-konton">
          {reserverade.map((post) => (
            <option key={post.konto} value={post.konto}>
              {konton.get(post.konto)?.namn ?? ''}
            </option>
          ))}
        </datalist>
        {befintligt !== undefined && (
          <span className="listrad__sekundar" data-testid="kontonamn">
            {befintligt.namn}
          </span>
        )}
      </div>

      {befintligt === undefined && riktning === 'reservera' && (
        <div className="faltgrupp">
          <label htmlFor="foreningskapital-namn">Namn på ändamålet</label>
          <input
            id="foreningskapital-namn"
            className="falt"
            autoComplete="off"
            value={namn}
            onChange={(handelse) => setNamn(handelse.target.value)}
          />
          <span className="listrad__sekundar">
            Kontot finns inte ännu och skapas med det här namnet.
          </span>
        </div>
      )}

      <div className="faltgrupp">
        <label htmlFor="foreningskapital-belopp">Belopp</label>
        <input
          id="foreningskapital-belopp"
          className="falt"
          inputMode="decimal"
          value={beloppText}
          onChange={(handelse) => setBeloppText(handelse.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="foreningskapital-datum">Datum</label>
        <input
          id="foreningskapital-datum"
          className="falt"
          type="date"
          value={datum}
          onChange={(handelse) => setDatum(handelse.target.value as Datum)}
        />
      </div>

      <button
        type="button"
        className="knapp knapp--primar"
        disabled={
          arbetar ||
          kontoNummer === undefined ||
          beloppOre === undefined ||
          beloppOre <= 0 ||
          (befintligt === undefined && namn.trim() === '')
        }
        data-testid="bokfor-reservering"
        onClick={() =>
          void kor(async () => {
            const resultat = await onBokfor({
              datum,
              konto: kontoNummer!,
              namn: befintligt?.namn ?? namn,
              belopp: beloppOre!,
              riktning,
            });
            setBeloppText('');
            setUppdatering((antal) => antal + 1);
            return resultat;
          })
        }
      >
        Bokför {riktning === 'reservera' ? 'reserveringen' : 'frigörelsen'}
      </button>

      {besked !== undefined && (
        <p className="kort" role="status" data-testid="foreningskapital-besked">
          {besked}
        </p>
      )}
      {fel !== undefined && (
        <p role="alert" data-testid="foreningskapital-fel">
          {fel}
        </p>
      )}
    </section>
  );
}
