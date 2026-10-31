import { useMemo, useState } from 'react';

import { formatKronor, type Ore } from '../../domain/belopp/ore';
import type { Uuid } from '../../domain/id/uuidv7';
import type { Konto, Kontonummer } from '../../domain/konto/konto';
import type { Projekt } from '../../domain/projekt/projekt';
import {
  projektutdrag,
  type Kontosumma,
  type Projektperiod,
} from '../../domain/projekt/projektutdrag';
import { projektutdragTabell } from '../../domain/export/tabeller';
import type { Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import { beteckning, type BokfortVerifikat } from '../../domain/verifikat/verifikat';
import { useFilprefix } from '../../ui/bok';
import { Exportknappar } from '../rapport/Exportknappar';

interface Props {
  readonly projekt: readonly Projekt[];
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  /** Every year's verifikat: a project can reach across the turn of the year. */
  readonly verifikat: readonly BokfortVerifikat[];
  readonly rakenskapsar: readonly Rakenskapsar[];
}

const HELA_TIDEN = 'hela';

/**
 * The huvudbok for one project: what came in, what it cost, and what is left
 * of a grant, with the rader behind the figures.
 *
 * Whole life by default, since a grant seldom keeps to one räkenskapsår, and
 * one year at a time when the question is a year's. The sums and the rader
 * come from the same function as the export, so the file and the screen cannot
 * say different things.
 */
export function Projektutdrag({ projekt, konton, verifikat, rakenskapsar }: Props) {
  const filprefix = useFilprefix();
  const [projektId, setProjektId] = useState<Uuid | undefined>(projekt[0]?.id);
  const [period, setPeriod] = useState<string>(HELA_TIDEN);

  const aren = useMemo(
    () => [...rakenskapsar].sort((a, b) => b.start.localeCompare(a.start)),
    [rakenskapsar],
  );
  const valt = projekt.find((post) => post.id === projektId) ?? projekt[0];
  const valtAr = aren.find((ar) => ar.id === period);
  const tid = useMemo<Projektperiod | undefined>(
    () => (valtAr === undefined ? undefined : { start: valtAr.start, slut: valtAr.slut }),
    [valtAr],
  );

  const utdrag = useMemo(
    () => (valt === undefined ? undefined : projektutdrag(valt, verifikat, tid)),
    [valt, verifikat, tid],
  );

  if (valt === undefined || utdrag === undefined) {
    return (
      <p className="tomt" data-testid="inga-projekt-i-rapport">
        Det finns inga projekt än. De läggs upp under Mer.
      </p>
    );
  }

  const namn = (konto: Kontonummer) => konton.get(konto)?.namn ?? '';
  const grupp = (
    testid: string,
    rubrik: string,
    poster: readonly Kontosumma[],
    summa: Ore,
  ) => (
    <div data-testid={testid}>
      <dl>
        <dt>{rubrik}</dt>
        <dd className="belopp">
          <strong>{formatKronor(summa)}</strong>
        </dd>
      </dl>
      {poster.length > 0 && (
        <ul className="lista">
          {poster.map((post) => (
            <li key={post.konto}>
              <div className="listrad">
                <span className="listrad__text">
                  <span>{post.konto}</span>
                  <span className="listrad__sekundar">{namn(post.konto)}</span>
                </span>
                <span className="belopp">{formatKronor(post.belopp)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <>
      <div className="faltgrupp">
        <label htmlFor="projektutdrag-projekt">Projekt</label>
        <select
          id="projektutdrag-projekt"
          className="falt"
          value={valt.id}
          onChange={(handelse) => setProjektId(handelse.target.value as Uuid)}
        >
          {projekt.map((post) => (
            <option key={post.id} value={post.id}>
              {post.kod} {post.namn}
              {post.avslutat ? ' (avslutat)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="faltgrupp">
        <label htmlFor="projektutdrag-period">Period</label>
        <select
          id="projektutdrag-period"
          className="falt"
          value={valtAr?.id ?? HELA_TIDEN}
          onChange={(handelse) => setPeriod(handelse.target.value)}
        >
          <option value={HELA_TIDEN}>Hela projektet</option>
          {aren.map((ar) => (
            <option key={ar.id} value={ar.id}>
              {ar.start} – {ar.slut}
            </option>
          ))}
        </select>
      </div>

      <div data-testid="projektutdrag">
        {grupp('pu-intakter', 'Intäkter', utdrag.intakter, utdrag.summaIntakter)}
        {grupp('pu-kostnader', 'Kostnader', utdrag.kostnader, utdrag.summaKostnader)}
        {utdrag.finansiella.length > 0 &&
          grupp(
            'pu-finansiella',
            'Finansiella poster',
            utdrag.finansiella,
            utdrag.summaFinansiella,
          )}

        <dl data-testid="pu-resultat">
          <dt>Resultat</dt>
          <dd className={`belopp${utdrag.resultat < 0 ? ' belopp--negativ' : ''}`}>
            <strong>{formatKronor(utdrag.resultat)}</strong>
          </dd>
        </dl>

        {grupp(
          'pu-skulder',
          'Skuld kvar på projektet',
          utdrag.skulder,
          utdrag.summaSkulder,
        )}
        <p className="hjalptext">
          Ett bidrag som tagits emot men ännu inte tagits upp som intäkt ligger som skuld
          på projektet, om det bokförts så. Det som står kvar där är det som återstår att
          använda. Skulden räknas till periodens slut, från projektets början.
        </p>
        {utdrag.tillgangar.length > 0 &&
          grupp(
            'pu-tillgangar',
            'Tillgångar på projektet',
            utdrag.tillgangar,
            utdrag.summaTillgangar,
          )}
      </div>

      <Exportknappar
        tabell={projektutdragTabell(utdrag, konton)}
        namn={`${filprefix}-projekt-${valt.kod}`}
      />

      <h3>Rader</h3>
      {utdrag.rader.length === 0 ? (
        <p className="tomt" data-testid="inga-projektrader">
          Inget är bokfört på projektet under perioden.
        </p>
      ) : (
        <ul className="lista" data-testid="projektrader">
          {utdrag.rader.map((rad, index) => (
            <li key={`${rad.verifikat.id}-${index}`}>
              <div className="listrad">
                <span className="listrad__text">
                  <span>
                    {rad.datum} · {beteckning(rad.verifikat)}
                  </span>
                  <span className="listrad__sekundar">
                    {rad.konto} {namn(rad.konto)} · {rad.text}
                  </span>
                </span>
                <span className={`belopp${rad.belopp < 0 ? ' belopp--negativ' : ''}`}>
                  {formatKronor(rad.belopp)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
