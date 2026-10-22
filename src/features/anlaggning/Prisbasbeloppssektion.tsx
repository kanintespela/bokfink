import { useState } from 'react';

import { formatKronor, kronorString, type Ore } from '../../domain/belopp/ore';
import {
  kandaPrisbasbelopp,
  kontrolleraPrisbasbelopp,
} from '../../domain/skatt/skattetabell';
import type { Datum } from '../../domain/tid/datum';
import { tolkaBelopp } from '../bokfor/Beloppsfalt';

interface Props {
  readonly egna: ReadonlyMap<number, Ore>;
  readonly idag: Datum;
  /** Asks SCB for the year. The only thing sent is the year itself. */
  readonly onHamta: (ar: number) => Promise<Ore>;
  readonly onSpara: (ar: number, belopp: Ore) => Promise<void>;
}

/**
 * The prisbasbelopp behind the halvt-prisbasbelopp limits, and a way to add
 * a year the app does not ship with.
 *
 * Fetching fills the field and saving is a second press, so the figure is
 * seen before anything relies on it. SCB publishes the calculated amount in
 * July; regeringen confirms it in the autumn, and the two have agreed.
 */
export function Prisbasbeloppssektion({ egna, idag, onHamta, onSpara }: Props) {
  const [arText, setArText] = useState(idag.slice(0, 4));
  const [beloppText, setBeloppText] = useState('');
  const [kalla, setKalla] = useState<string | undefined>();
  const [arbetar, setArbetar] = useState(false);
  const [besked, setBesked] = useState<string | undefined>();
  const [fel, setFel] = useState<string | undefined>();

  const ar = Number(arText);
  const belopp = tolkaBelopp(beloppText);
  const kanda = kandaPrisbasbelopp(egna);

  const hinder = (() => {
    if (!/^\d{4}$/.test(arText)) {
      return 'Skriv året med fyra siffror.';
    }
    if (kanda.has(ar) && !kanda.get(ar)!.eget) {
      return `Prisbasbeloppet för ${ar} finns redan i appen.`;
    }
    if (belopp === undefined) {
      return 'Hämta beloppet från SCB eller skriv in det.';
    }
    try {
      kontrolleraPrisbasbelopp(belopp);
    } catch (orsak) {
      return orsak instanceof Error ? orsak.message : String(orsak);
    }
    return undefined;
  })();

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

  return (
    <div className="kort" data-testid="prisbasbelopp">
      <h3>Prisbasbelopp</h3>
      <p className="hjalptext">
        Gränsen för inventarier och lager som får kostnadsföras direkt är ett halvt
        prisbasbelopp för räkenskapsåret.
      </p>

      <ul className="lista" data-testid="kanda-prisbasbelopp">
        {[...kanda].map(([kandAr, post]) => (
          <li key={kandAr}>
            <div className="listrad">
              <span className="listrad__text">
                <span>{kandAr}</span>
                {post.eget && <span className="listrad__sekundar">inlagt av dig</span>}
              </span>
              <span className="belopp">{formatKronor(post.belopp)}</span>
            </div>
          </li>
        ))}
      </ul>

      <div className="faltgrupp">
        <label htmlFor="pbb-ar">År</label>
        <input
          id="pbb-ar"
          className="falt"
          inputMode="numeric"
          value={arText}
          onChange={(handelse) => {
            setArText(handelse.target.value);
            setKalla(undefined);
          }}
        />
      </div>

      <p>
        <button
          type="button"
          className="knapp"
          disabled={arbetar || !/^\d{4}$/.test(arText)}
          data-testid="hamta-prisbasbelopp"
          onClick={() =>
            void kor(async () => {
              const hamtat = await onHamta(ar);
              setBeloppText(kronorString(hamtat).replace(/\.00$/, ''));
              setKalla('SCB');
              return `SCB anger ${formatKronor(hamtat)} kr för ${ar}. Spara om det stämmer.`;
            })
          }
        >
          Hämta från SCB
        </button>
      </p>

      <div className="faltgrupp">
        <label htmlFor="pbb-belopp">Prisbasbelopp, kronor</label>
        <input
          id="pbb-belopp"
          className="falt"
          inputMode="decimal"
          value={beloppText}
          onChange={(handelse) => {
            setBeloppText(handelse.target.value);
            setKalla(undefined);
          }}
        />
        {kalla !== undefined && (
          <span className="listrad__sekundar">Hämtat från {kalla}</span>
        )}
      </div>

      {hinder !== undefined && besked === undefined && (
        <p className="hjalptext" data-testid="pbb-hinder">
          {hinder}
        </p>
      )}

      <button
        type="button"
        className="knapp knapp--primar"
        disabled={arbetar || hinder !== undefined}
        data-testid="spara-prisbasbelopp"
        onClick={() =>
          void kor(async () => {
            await onSpara(ar, belopp!);
            setBeloppText('');
            setKalla(undefined);
            return `Prisbasbeloppet för ${ar} sparades.`;
          })
        }
      >
        Spara
      </button>

      {besked !== undefined && (
        <p role="status" data-testid="pbb-besked">
          {besked}
        </p>
      )}
      {fel !== undefined && (
        <p role="alert" data-testid="pbb-fel">
          {fel}
        </p>
      )}
    </div>
  );
}
