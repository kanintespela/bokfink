import { useMemo, useState } from 'react';

import { formatKronor, isZero, negate, subtract } from '../../domain/belopp/ore';
import {
  arMomsavrakning,
  beraknaMomsrapport,
  EU_FORSALJNING,
  harEuForsaljning,
} from '../../domain/moms/momsrapport';
import { perioder, type Momsperiod } from '../../domain/moms/period';
import {
  METODBESKRIVNING,
  METODNAMN,
  type Redovisningsmetod,
} from '../../domain/moms/redovisningsmetod';
import type { Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import type { Datum } from '../../domain/tid/datum';
import { beteckning, type BokfortVerifikat } from '../../domain/verifikat/verifikat';
import { inomIntervall } from '../../domain/tid/datum';

const PERIODNAMN: Record<Momsperiod, string> = {
  manad: 'Varje månad',
  kvartal: 'Varje kvartal',
  ar: 'En gång om året',
};

interface Props {
  /** Every fiscal year, so a period of last year can still be declared. */
  readonly rakenskapsar: readonly Rakenskapsar[];
  /** Every booked verifikat; the report picks the period's own. */
  readonly verifikat: readonly BokfortVerifikat[];
  readonly momsperiod: Momsperiod;
  readonly onMomsperiod: (period: Momsperiod) => Promise<void>;
  readonly metod: Redovisningsmetod;
  readonly onMetod: (metod: Redovisningsmetod) => Promise<void>;
  readonly onLas: (ar: Rakenskapsar, tom: Datum) => Promise<void>;
  readonly onExportera: (fran: Datum, till: Datum) => Promise<void>;
  /** Books the period's momsredovisning and says what it was booked as. */
  readonly onBokforMomsredovisning: (fran: Datum, till: Datum) => Promise<string>;
}

/**
 * The momsdeklaration, box by box.
 *
 * Every box the return has, including the ones that are empty. A box left out
 * because it happened to be zero is a box nobody checks, and the one time it
 * should not have been zero is the time it matters.
 */
export function Momssida({
  rakenskapsar,
  verifikat,
  momsperiod,
  onMomsperiod,
  metod,
  onMetod,
  onLas,
  onExportera,
  onBokforMomsredovisning,
}: Props) {
  /*
   * Which year's periods are shown. Undefined means "the one that needs
   * doing": the momsdeklaration for the fourth quarter is due in February,
   * after the app has moved on to a new year, and opening on an empty new
   * year would hide the one period that is actually waiting.
   */
  const [valtArId, setValtArId] = useState<Rakenskapsar['id'] | undefined>();
  const aret =
    rakenskapsar.find((kandidat) => kandidat.id === valtArId) ??
    forstaOdeklareradeAr(rakenskapsar);
  const [valdPeriod, setValdPeriod] = useState<number | undefined>();
  const [arbetar, setArbetar] = useState(false);
  const [fel, setFel] = useState<string | undefined>();
  const [besked, setBesked] = useState<string | undefined>();

  /** Runs one step and shows what it said, or why it failed (hard rule 11). */
  function kor(uppgift: () => Promise<string | void>) {
    setArbetar(true);
    setFel(undefined);
    setBesked(undefined);
    void uppgift()
      .then((svar) => setBesked(svar ?? undefined))
      .catch((orsak: unknown) =>
        setFel(orsak instanceof Error ? orsak.message : String(orsak)),
      )
      .finally(() => setArbetar(false));
  }

  const perioderna = useMemo(
    () => (aret === undefined ? [] : perioder(aret.start, aret.slut, momsperiod)),
    [aret, momsperiod],
  );

  // Unless one was picked, the first period the lock does not cover yet.
  const forstaOlasta = Math.max(
    0,
    perioderna.findIndex(
      (kandidat) => aret?.momslastTom === undefined || kandidat.till > aret.momslastTom,
    ),
  );
  const period = perioderna[Math.min(valdPeriod ?? forstaOlasta, perioderna.length - 1)];

  const rapport = useMemo(
    () =>
      period === undefined
        ? undefined
        : beraknaMomsrapport({ fran: period.fran, till: period.till, verifikat }),
    [period, verifikat],
  );

  if (aret === undefined || period === undefined || rapport === undefined) {
    return (
      <p className="tomt" data-testid="ingen-momsperiod">
        Lägg upp ett räkenskapsår för att kunna redovisa moms.
      </p>
    );
  }

  const redanLast = aret.momslastTom !== undefined && aret.momslastTom >= period.till;
  // The period's own settlement, when it has been booked.
  const avrakning = verifikat.find(
    (post) =>
      inomIntervall(post.datum, period.fran, period.till) &&
      arMomsavrakning(post.konteringar),
  );

  return (
    <section aria-label="Moms">
      <h2>Momsdeklaration</h2>

      <div className="faltgrupp">
        <label htmlFor="momsperiod">Redovisningsperiod</label>
        <select
          id="momsperiod"
          className="falt"
          value={momsperiod}
          onChange={(handelse) => void onMomsperiod(handelse.target.value as Momsperiod)}
        >
          {(Object.keys(PERIODNAMN) as Momsperiod[]).map((kandidat) => (
            <option key={kandidat} value={kandidat}>
              {PERIODNAMN[kandidat]}
            </option>
          ))}
        </select>
      </div>

      {rakenskapsar.length > 1 && (
        <div className="faltgrupp">
          <label htmlFor="momsar">Räkenskapsår</label>
          <select
            id="momsar"
            className="falt"
            value={aret.id}
            onChange={(handelse) => {
              setValtArId(handelse.target.value as Rakenskapsar['id']);
              setValdPeriod(undefined);
            }}
          >
            {[...rakenskapsar]
              .sort((a, b) => b.start.localeCompare(a.start))
              .map((kandidat) => (
                <option key={kandidat.id} value={kandidat.id}>
                  {kandidat.start.slice(0, 4)}
                </option>
              ))}
          </select>
        </div>
      )}

      <div className="faltgrupp">
        <label htmlFor="period">Period</label>
        <select
          id="period"
          className="falt"
          value={perioderna.indexOf(period)}
          onChange={(handelse) => {
            setValtArId(aret.id);
            setValdPeriod(Number(handelse.target.value));
          }}
        >
          {perioderna.map((kandidat, index) => (
            <option key={kandidat.namn} value={index}>
              {kandidat.namn}
            </option>
          ))}
        </select>
      </div>

      <div className="faltgrupp">
        <label htmlFor="metod">Redovisningsmetod</label>
        <select
          id="metod"
          className="falt"
          value={metod}
          onChange={(handelse) =>
            void onMetod(handelse.target.value as Redovisningsmetod)
          }
        >
          {(Object.keys(METODNAMN) as Redovisningsmetod[]).map((kandidat) => (
            <option key={kandidat} value={kandidat}>
              {METODNAMN[kandidat]}
            </option>
          ))}
        </select>
      </div>

      <p data-testid="metodbeskrivning">{METODBESKRIVNING[metod]}</p>

      <p className="kort" data-testid="momssumma">
        <strong className="belopp">
          {rapport.attBetala >= 0
            ? `${formatKronor(rapport.attBetala)} kr att betala`
            : `${formatKronor(negate(rapport.attBetala))} kr att få tillbaka`}
        </strong>
      </p>

      <ul className="lista" data-testid="momsrutor">
        {rapport.rader.map((rad) => (
          <li key={rad.ruta.nummer}>
            <div className="listrad">
              <span className="listrad__text">
                {/* Written the way the form writes them: 05, not 5. */}
                <span>Ruta {String(rad.ruta.nummer).padStart(2, '0')}</span>
                <span className="listrad__sekundar">{rad.ruta.rubrik}</span>
              </span>
              <span className={`belopp${rad.belopp < 0 ? ' belopp--negativ' : ''}`}>
                {formatKronor(rad.belopp)}
                {!isZero(subtract(rad.exakt, rad.belopp)) && (
                  <span className="listrad__sekundar"> ({formatKronor(rad.exakt)})</span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <p>
        Beloppen är avrundade till hela kronor med öretalen borttagna, som en deklaration
        ska vara. Den exakta siffran ur bokföringen står inom parentes där de skiljer sig.
      </p>

      {harEuForsaljning(rapport) && (
        <div className="kort" data-testid="eu-forsaljning">
          <strong>Periodisk sammanställning behövs</strong>
          <p>
            Perioden innehåller försäljning till andra EU-länder. Den ska dessutom
            redovisas i en periodisk sammanställning, per köpares momsregistreringsnummer.
          </p>
          <ul className="lista">
            {rapport.rader
              .filter((rad) => EU_FORSALJNING.includes(rad.ruta.nummer))
              .map((rad) => (
                <li key={rad.ruta.nummer}>
                  <div className="listrad">
                    <span className="listrad__text">
                      <span>Ruta {String(rad.ruta.nummer).padStart(2, '0')}</span>
                      <span className="listrad__sekundar">{rad.ruta.rubrik}</span>
                    </span>
                    <span className="belopp">{formatKronor(rad.belopp)}</span>
                  </div>
                </li>
              ))}
          </ul>
          <p>
            Kontera kan visa beloppen men ännu inte vilka köpare de gäller — kundregistret
            kommer i en senare etapp. Lämna sammanställningen i Skatteverkets e-tjänst så
            länge.
          </p>
        </div>
      )}

      <p>
        <button
          type="button"
          className="knapp"
          disabled={arbetar}
          data-testid="exportera-eskd"
          onClick={() => kor(() => onExportera(period.fran, period.till))}
        >
          Exportera som eSKD-fil
        </button>
      </p>

      {avrakning === undefined ? (
        <div className="kort">
          <p>
            När deklarationen är klar flyttas periodens moms till konto 2650. Därifrån
            bokförs sedan betalningen till eller från Skatteverket.
          </p>
          <button
            type="button"
            className="knapp"
            disabled={arbetar}
            data-testid="bokfor-momsredovisning"
            onClick={() => kor(() => onBokforMomsredovisning(period.fran, period.till))}
          >
            Bokför momsredovisningen
          </button>
        </div>
      ) : (
        <p data-testid="momsredovisning-bokford">
          Momsen är redovisad mot 2650 i {beteckning(avrakning)}.
        </p>
      )}

      {besked !== undefined && (
        <p className="kort" role="status" data-testid="moms-besked">
          {besked}
        </p>
      )}

      {fel !== undefined && (
        <p role="alert" data-testid="moms-fel">
          {fel}
        </p>
      )}

      {redanLast ? (
        <p data-testid="redan-last">
          Perioden är låst till och med {aret.momslastTom}. Inget som påverkar
          momsdeklarationen kan bokföras i den längre, men bokslutets poster går
          fortfarande.
        </p>
      ) : (
        <p>
          <button
            type="button"
            className="knapp"
            disabled={arbetar || aret.avslutat}
            data-testid="las-period"
            onClick={() => {
              // Stay on this period once it is locked, rather than follow
              // the default on to whatever is waiting next.
              setValtArId(aret.id);
              setValdPeriod(perioderna.indexOf(period));
              kor(() => onLas(aret, period.till));
            }}
          >
            Lås perioden till och med {period.till}
          </button>
        </p>
      )}
    </section>
  );
}

/**
 * The oldest year whose momsdeklarationer are not all locked, or the newest
 * year when every one is.
 *
 * A lock through the year's last day is what a filed fourth quarter leaves
 * behind, so a year without one still has a declaration waiting.
 */
function forstaOdeklareradeAr(
  rakenskapsar: readonly Rakenskapsar[],
): Rakenskapsar | undefined {
  const iOrdning = [...rakenskapsar].sort((a, b) => a.start.localeCompare(b.start));
  return (
    iOrdning.find(
      (ar) => !ar.avslutat && (ar.momslastTom === undefined || ar.momslastTom < ar.slut),
    ) ?? iOrdning[iOrdning.length - 1]
  );
}
