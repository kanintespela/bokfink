import type { Bokprofil } from '../../domain/bok/bokprofil';
import { giltigtOrganisationsnummer } from '../../domain/moms/eskd';
import type { Momsperiod } from '../../domain/moms/period';
import {
  METODBESKRIVNING,
  METODNAMN,
  type Redovisningsmetod,
} from '../../domain/moms/redovisningsmetod';
import { BRANSCHER, BRANSCHNAMN, type Bransch } from '../../domain/bok/bransch';
import { PERIODNAMN } from '../moms/namn';

interface Props {
  readonly profil: Bokprofil;
  /** What the firm does; it orders the booking questions and nothing else. */
  readonly bransch: Bransch;
  readonly onBransch: (bransch: Bransch) => Promise<void>;
  /** Whether the book has moms to declare; for a firm it always does. */
  readonly momsregistrerad: boolean;
  readonly onMomsregistrerad: (registrerad: boolean) => Promise<void>;
  readonly organisationsnummer: string;
  readonly onOrganisationsnummer: (nummer: string) => Promise<void>;
  readonly momsperiod: Momsperiod;
  readonly onMomsperiod: (period: Momsperiod) => Promise<void>;
  readonly metod: Redovisningsmetod;
  readonly onMetod: (metod: Redovisningsmetod) => Promise<void>;
}

/**
 * The few things about the business itself that the app has to know.
 *
 * The moms period and the accounting method are here rather than on the
 * Moms page: both follow from how the firm is registered with Skatteverket,
 * are set once and changed perhaps never, and on the Moms page they sat as
 * the first two things on a screen opened to file a declaration.
 */
export function Foretagsinstallningar({
  profil,
  bransch,
  onBransch,
  momsregistrerad,
  onMomsregistrerad,
  organisationsnummer,
  onOrganisationsnummer,
  momsperiod,
  onMomsperiod,
  metod,
  onMetod,
}: Props) {
  // Not while the number is still being typed: a short one is just unfinished.
  const ogiltigt =
    organisationsnummer.replace(/\D/g, '').length >= 10 &&
    !giltigtOrganisationsnummer(organisationsnummer);

  return (
    <section aria-label="Företaget">
      <h2>Företaget</h2>

      <div className="faltgrupp">
        <label htmlFor="orgnr">Organisationsnummer</label>
        <input
          id="orgnr"
          className="falt"
          inputMode="numeric"
          autoComplete="off"
          placeholder="ÅÅMMDD-NNNN"
          value={organisationsnummer}
          aria-invalid={ogiltigt}
          aria-describedby={ogiltigt ? 'orgnr-fel' : undefined}
          onChange={(handelse) => void onOrganisationsnummer(handelse.target.value)}
        />
        {ogiltigt && (
          <p id="orgnr-fel" role="alert" data-testid="orgnr-fel">
            Numret stämmer inte: kontrollsiffran på slutet passar inte de andra siffrorna.
            Kontrollera att du skrivit rätt, annars avvisar Skatteverket
            momsdeklarationen.
          </p>
        )}
      </div>

      {profil === 'enskild_firma' && (
        <div className="faltgrupp">
          <label htmlFor="bransch">Vad gör firman?</label>
          <select
            id="bransch"
            className="falt"
            value={bransch}
            onChange={(handelse) => void onBransch(handelse.target.value as Bransch)}
          >
            {BRANSCHER.map((kandidat) => (
              <option key={kandidat} value={kandidat}>
                {BRANSCHNAMN[kandidat]}
              </option>
            ))}
          </select>
          <p className="hjalptext">
            Styr bara i vilken ordning frågorna visas när du bokför. Allt går att bokföra
            oavsett vad du väljer, och du kan byta när som helst.
          </p>
        </div>
      )}

      {profil === 'forening' ? (
        <p>
          Föreningens organisationsnummer. Det behövs bara för momsdeklarationen, om
          föreningen har någon, och lämnar aldrig enheten.
        </p>
      ) : (
        <p>
          För enskild firma är det innehavarens personnummer, med eller utan sekelsiffror.
          Det behövs bara för momsdeklarationen och lämnar aldrig enheten.
        </p>
      )}

      {profil === 'forening' && (
        <>
          <div className="faltgrupp">
            <label htmlFor="momsregistrerad">Momsregistrering</label>
            <select
              id="momsregistrerad"
              className="falt"
              value={momsregistrerad ? 'ja' : 'nej'}
              onChange={(handelse) =>
                void onMomsregistrerad(handelse.target.value === 'ja')
              }
            >
              <option value="nej">Föreningen är inte momsregistrerad</option>
              <option value="ja">Föreningen är momsregistrerad</option>
            </select>
          </div>
          <p className="hjalptext" data-testid="momsregistrering-hjalp">
            Medlemsavgifter och bidrag har ingen moms. En förening som inte är
            momsregistrerad får inte dra av momsen på sina inköp, så den räknas som en del
            av kostnaden. Slå på momsregistrering om föreningen har registrerat sig hos
            Skatteverket, till exempel för att den har valt frivillig skattskyldighet för
            uthyrning av en lokal.
          </p>
        </>
      )}

      {momsregistrerad && (
        <div className="faltgrupp">
          <label htmlFor="momsperiod">Redovisningsperiod för moms</label>
          <select
            id="momsperiod"
            className="falt"
            value={momsperiod}
            onChange={(handelse) =>
              void onMomsperiod(handelse.target.value as Momsperiod)
            }
          >
            {(Object.keys(PERIODNAMN) as Momsperiod[]).map((kandidat) => (
              <option key={kandidat} value={kandidat}>
                {PERIODNAMN[kandidat]}
              </option>
            ))}
          </select>
        </div>
      )}

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

      <p className="hjalptext" data-testid="metodbeskrivning">
        {METODBESKRIVNING[metod]}
      </p>
    </section>
  );
}
