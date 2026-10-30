import { useState } from 'react';

import { LANGSTA_BOKNAMN, type Bok } from '../../data/bokregister';
import { BOKPROFILER, BOKPROFILNAMN, type Bokprofil } from '../../domain/bok/bokprofil';
import { Uppgiftsstatus, useUppgift } from '../data/uppgift';

/** The books on this device, and what can be done with them. */
export interface Bokval {
  readonly bocker: readonly Bok[];
  readonly aktiv: Bok;
  /** Opens another book. The whole app starts over in it. */
  readonly onValj: (id: string) => Promise<void>;
  readonly onSkapa: (namn: string, profil: Bokprofil) => Promise<void>;
  readonly onBytNamn: (namn: string) => Promise<void>;
}

/**
 * Separate books, such as one's own firm and an association one keeps the
 * books for.
 *
 * Nothing moves between them: each has its own verifikat, accounts, fiscal
 * years, backups and exports. Choosing a book opens it on this device only,
 * and the other device chooses for itself.
 */
export function Bocker({ bocker, aktiv, onValj, onSkapa, onBytNamn }: Bokval) {
  const [nyttNamn, setNyttNamn] = useState('');
  /*
   * Nothing chosen to begin with. The choice cannot be changed once the book
   * exists, so a preselected answer would be one that is wrong for whoever
   * does not look.
   */
  const [nyProfil, setNyProfil] = useState<Bokprofil | undefined>();
  const [namn, setNamn] = useState(aktiv.namn);
  const { arbetar, besked, fel, kor } = useUppgift();

  return (
    <section aria-label="Böcker">
      <h2>Böcker</h2>
      <p className="hjalptext">
        Varje bok är en egen bokföring, till exempel din firma och en förening du är
        kassör i. Verifikat, konton, säkerhetskopior och exporter hålls helt isär.
      </p>

      <ul className="lista">
        {bocker.map((bok) => (
          <li key={bok.id}>
            <button
              type="button"
              className="listrad"
              aria-current={bok.id === aktiv.id ? 'true' : undefined}
              disabled={arbetar || bok.id === aktiv.id}
              onClick={() =>
                void kor(async () => {
                  await onValj(bok.id);
                  return `${bok.namn} är öppnad.`;
                })
              }
            >
              <span className="listrad__text">
                <strong>{bok.namn}</strong>
              </span>
              <span className="listrad__sekundar">
                {bok.id === aktiv.id ? 'Öppen' : 'Öppna'}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <h2>Byt namn på {aktiv.namn}</h2>
      <form
        onSubmit={(handelse) => {
          handelse.preventDefault();
          void kor(async () => {
            await onBytNamn(namn);
            return 'Namnet är sparat.';
          });
        }}
      >
        <div className="faltgrupp">
          <label htmlFor="boknamn">Namn</label>
          <input
            id="boknamn"
            className="falt"
            autoComplete="off"
            maxLength={LANGSTA_BOKNAMN}
            value={namn}
            onChange={(handelse) => setNamn(handelse.target.value)}
          />
        </div>
        <button type="submit" className="knapp" disabled={arbetar}>
          Spara namnet
        </button>
      </form>

      <h2>Ny bok</h2>
      <form
        onSubmit={(handelse) => {
          handelse.preventDefault();
          void kor(async () => {
            if (nyProfil === undefined) {
              throw new Error(
                'Välj om boken är en enskild firma eller en ideell förening.',
              );
            }
            await onSkapa(nyttNamn, nyProfil);
            setNyProfil(undefined);
            return 'Boken är skapad och öppnad.';
          });
        }}
      >
        <div className="faltgrupp">
          <label htmlFor="nybok">Namn på den nya boken</label>
          <input
            id="nybok"
            className="falt"
            autoComplete="off"
            maxLength={LANGSTA_BOKNAMN}
            placeholder="Till exempel Bygdegårdsföreningen"
            value={nyttNamn}
            onChange={(handelse) => setNyttNamn(handelse.target.value)}
          />
        </div>
        <div className="faltgrupp" role="group" aria-labelledby="bokprofil">
          <span id="bokprofil">Vad är det för bok?</span>
          <div className="segment">
            {BOKPROFILER.map((profil) => (
              <button
                key={profil}
                type="button"
                aria-pressed={nyProfil === profil}
                onClick={() => setNyProfil(profil)}
              >
                {BOKPROFILNAMN[profil]}
              </button>
            ))}
          </div>
          <p className="hjalptext">
            Det går inte att ändra efteråt, eftersom reglerna, kontona och bokslutet
            skiljer sig. Skapa i stället en ny bok om du valde fel innan du bokfört något.
          </p>
        </div>
        <p className="hjalptext">
          Den nya boken börjar tom, med ett räkenskapsår och grundkonton. Har föreningen
          bokfört i ett annat program kan du läsa in dess SIE-fil under Filer, import och
          export.
        </p>
        <button type="submit" className="knapp knapp--primar" disabled={arbetar}>
          Skapa och öppna boken
        </button>
      </form>

      <Uppgiftsstatus arbetar={arbetar} besked={besked} fel={fel} />
    </section>
  );
}
