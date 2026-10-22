import { useMemo, useState } from 'react';

import {
  harledKontotyp,
  kontonummer,
  skapaKonto,
  type Konto,
  type Kontonummer,
  type Kontotyp,
} from '../../domain/konto/konto';
import { sokKonton } from '../../domain/konto/kontosok';

const TYPNAMN: Record<Kontotyp, string> = {
  tillgang: 'Tillgång',
  egetKapital: 'Eget kapital',
  skuld: 'Skuld',
  intakt: 'Intäkt',
  kostnad: 'Kostnad',
};

interface Props {
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly onSpara: (konto: Konto, fanns: boolean) => Promise<void>;
}

/**
 * The chart of accounts: searchable, with favourites and room for your own.
 *
 * Three hundred accounts is too many to scroll and too few to need anything
 * clever. Search is the same as when posting by hand - number or words of
 * the name, accents folded - favourites float to the top, and an account
 * that is no longer used is deactivated rather than deleted - it is still
 * named by every verifikat that ever used it.
 */
export function Kontosida({ konton, onSpara }: Props) {
  const [fraga, setFraga] = useState('');
  const [nyttNummer, setNyttNummer] = useState('');
  const [nyttNamn, setNyttNamn] = useState('');
  const [fel, setFel] = useState<string | undefined>();

  const traffar = useMemo(() => {
    const alla = [...konton.values()];
    if (fraga.trim().length > 0) {
      return sokKonton(alla, fraga).slice(0, 60);
    }
    return alla
      .sort((a, b) => {
        if (a.favorit !== b.favorit) {
          return a.favorit ? -1 : 1;
        }
        return a.nummer.localeCompare(b.nummer);
      })
      .slice(0, 60);
  }, [konton, fraga]);

  async function laggTill() {
    setFel(undefined);
    try {
      const nummer = kontonummer(nyttNummer);
      if (konton.has(nummer)) {
        setFel(`Konto ${nummer} finns redan.`);
        return;
      }
      if (harledKontotyp(nummer) === undefined) {
        setFel(
          `Kontoklass 8 rymmer både finansiella intäkter och kostnader, så ${nummer} ` +
            'går inte att lägga till här ännu.',
        );
        return;
      }
      await onSpara(skapaKonto({ nummer: nyttNummer, namn: nyttNamn }), false);
      setNyttNummer('');
      setNyttNamn('');
    } catch (orsak) {
      // Hard rule 11: shown, not swallowed.
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    }
  }

  return (
    <section aria-label="Konton">
      <h2>Konton</h2>

      <div className="faltgrupp">
        <label htmlFor="kontosok">Sök konto</label>
        <input
          id="kontosok"
          className="falt"
          type="search"
          autoComplete="off"
          placeholder="Nummer eller namn"
          value={fraga}
          onChange={(handelse) => setFraga(handelse.target.value)}
        />
      </div>

      {traffar.length === 0 ? (
        <p className="tomt" data-testid="inga-konton">
          Inget konto matchar ”{fraga}”.
        </p>
      ) : (
        <ul className="lista" data-testid="kontolista">
          {traffar.map((konto) => (
            <li key={konto.nummer}>
              <div className="listrad">
                <span className="listrad__text">
                  <span>
                    {konto.nummer} {konto.namn}
                  </span>
                  <span className="listrad__sekundar">
                    {TYPNAMN[konto.typ]}
                    {!konto.aktiv && ' · inaktivt'}
                  </span>
                </span>
                <button
                  type="button"
                  className="knapp knapp--text knapp--ikon"
                  aria-pressed={konto.favorit}
                  aria-label={konto.favorit ? 'Ta bort som favorit' : 'Gör till favorit'}
                  data-testid={`favorit-${konto.nummer}`}
                  onClick={() =>
                    void onSpara({ ...konto, favorit: !konto.favorit }, true)
                  }
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    fill={konto.favorit ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3.5l2.7 5.6 6.1.8-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.8z" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2>Lägg till eget konto</h2>

      <div className="faltgrupp">
        <label htmlFor="nyttkonto">Kontonummer</label>
        <input
          id="nyttkonto"
          className="falt"
          inputMode="numeric"
          autoComplete="off"
          placeholder="1930"
          value={nyttNummer}
          onChange={(handelse) => setNyttNummer(handelse.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="nyttkontonamn">Namn</label>
        <input
          id="nyttkontonamn"
          className="falt"
          type="text"
          autoComplete="off"
          value={nyttNamn}
          onChange={(handelse) => setNyttNamn(handelse.target.value)}
        />
      </div>

      {fel !== undefined && (
        <p role="alert" data-testid="kontofel">
          {fel}
        </p>
      )}

      <button
        type="button"
        className="knapp"
        data-testid="lagg-till-konto"
        disabled={nyttNummer.trim().length === 0 || nyttNamn.trim().length === 0}
        onClick={() => void laggTill()}
      >
        Lägg till
      </button>
    </section>
  );
}
