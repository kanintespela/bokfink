import { useState } from 'react';

import { BOKPROFILER, BOKPROFILNAMN, type Bokprofil } from '../../domain/bok/bokprofil';
import { PERIODNAMN } from '../moms/namn';
import type { Momsperiod } from '../../domain/moms/period';
import { granskaBoknamn } from '../../data/bokregister';
import type { Valkomstsvar } from '../../data/valkomst';

export interface Valkomstval extends Valkomstsvar {
  /** What the owner called the book; undefined keeps the name it has. */
  readonly namn: string | undefined;
}

interface Props {
  readonly onKlar: (val: Valkomstval) => Promise<void>;
  /** Makes an example book to look around in, and opens it. */
  readonly onExempel: () => Promise<void>;
  /** Opens the screen for reading a backup in, for someone who has used Bokfink before. */
  readonly onAterstall: () => Promise<void>;
}

/**
 * What a first-time user is asked, and nothing else.
 *
 * The app needs to know three things before it can be of use: whether the
 * books are a firm's or an association's (which decides the accounts and the
 * questions, and cannot be changed once something is booked), what to call
 * them, and how moms is reported (which only sets when the app reminds). Every
 * other setting has a sensible default and lives under Mer. It is shown in the
 * place of the overview, with the tab bar still there, so someone who would
 * rather look around first is not held up.
 */
export function Valkomst({ onKlar, onExempel, onAterstall }: Props) {
  const [profil, setProfil] = useState<Bokprofil>('enskild_firma');
  const [namn, setNamn] = useState('');
  const [momsregistrerad, setMomsregistrerad] = useState(false);
  const [momsperiod, setMomsperiod] = useState<Momsperiod>('kvartal');
  const [arbetar, setArbetar] = useState(false);
  const [fel, setFel] = useState<string | undefined>();

  const arForening = profil === 'forening';
  const visaPeriod = !arForening || momsregistrerad;

  async function borja() {
    setFel(undefined);
    let rentNamn: string | undefined;
    try {
      rentNamn = namn.trim() === '' ? undefined : granskaBoknamn(namn, []);
    } catch (orsak) {
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
      return;
    }
    setArbetar(true);
    try {
      await onKlar({ profil, namn: rentNamn, momsregistrerad, momsperiod });
    } catch (orsak) {
      // Hard rule 11: said here, next to the button that was pressed.
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setArbetar(false);
    }
  }

  return (
    <section aria-label="Välkommen" data-testid="valkomst">
      <h2>Välkommen</h2>
      <p>
        Bokfink är en bokföringsapp för enskild firma och ideell förening. Du svarar på
        vad som har hänt, så väljer appen konton och räknar ut momsen. Allt du bokför
        sparas på den här enheten och skickas inte någonstans.
      </p>
      <p>Tre frågor först, så att appen passar dig.</p>

      <div className="faltgrupp" role="group" aria-labelledby="valkomst-profil">
        <span id="valkomst-profil">Vad ska du bokföra?</span>
        <div className="segment">
          {BOKPROFILER.map((kandidat) => (
            <button
              key={kandidat}
              type="button"
              aria-pressed={profil === kandidat}
              onClick={() => setProfil(kandidat)}
            >
              {BOKPROFILNAMN[kandidat]}
            </button>
          ))}
        </div>
        <p className="hjalptext">
          Det går inte att ändra efter att du har börjat bokföra, eftersom konton, frågor
          och bokslut skiljer sig. Du kan lägga till fler böcker senare, till exempel en
          förening bredvid firman.
        </p>
      </div>

      <div className="faltgrupp">
        <label htmlFor="valkomst-namn">
          {arForening ? 'Vad heter föreningen?' : 'Vad heter firman?'}
        </label>
        <input
          id="valkomst-namn"
          className="falt"
          autoComplete="off"
          placeholder={arForening ? 'Till exempel Bygdegårdsföreningen' : 'Min bokföring'}
          value={namn}
          onChange={(handelse) => setNamn(handelse.target.value)}
        />
        <p className="hjalptext">
          Namnet syns bara för dig, i filnamnen och överst när du har flera böcker. Det
          går att byta under Mer, Böcker.
        </p>
      </div>

      {arForening && (
        <div className="faltgrupp" role="group" aria-labelledby="valkomst-moms">
          <span id="valkomst-moms">Är föreningen momsregistrerad?</span>
          <div className="segment">
            <button
              type="button"
              aria-pressed={!momsregistrerad}
              onClick={() => setMomsregistrerad(false)}
            >
              Nej
            </button>
            <button
              type="button"
              aria-pressed={momsregistrerad}
              onClick={() => setMomsregistrerad(true)}
            >
              Ja
            </button>
          </div>
          <p className="hjalptext">
            Medlemsavgifter och bidrag har ingen moms. Svara ja om föreningen har
            registrerat sig för moms hos Skatteverket, till exempel för att den hyr ut en
            lokal med frivillig skattskyldighet.
          </p>
        </div>
      )}

      {visaPeriod && (
        <div className="faltgrupp">
          <label htmlFor="valkomst-period">Hur ofta lämnar du momsdeklaration?</label>
          <select
            id="valkomst-period"
            className="falt"
            value={momsperiod}
            onChange={(handelse) => setMomsperiod(handelse.target.value as Momsperiod)}
          >
            {(Object.keys(PERIODNAMN) as Momsperiod[]).map((kandidat) => (
              <option key={kandidat} value={kandidat}>
                {PERIODNAMN[kandidat]}
              </option>
            ))}
          </select>
          <p className="hjalptext">
            Det framgår av Skatteverkets besked när du momsregistrerades, och du ser det
            på Skatteverkets Mina sidor. Svaret styr bara när appen påminner dig, och går
            att ändra under Mer, Företaget.
            {!arForening &&
              ' Är du inte momsregistrerad stöder appen inte det ännu: den räknar alltid med moms för en enskild firma.'}
          </p>
        </div>
      )}

      <p>
        <button
          type="button"
          className="knapp"
          disabled={arbetar}
          data-testid="valkomst-borja"
          onClick={() => void borja()}
        >
          Börja bokföra
        </button>
      </p>

      {fel !== undefined && (
        <p role="alert" data-testid="valkomst-fel">
          {fel}
        </p>
      )}

      <p className="hjalptext">
        Appen ber webbläsaren spara bokföringen när du går vidare. Svarar den nej säger
        översikten till.
      </p>

      <h3>Vill du bara titta först?</h3>
      <p className="hjalptext">
        En påhittad firma med ett års bokföring. Den ligger som en egen bok som går att ta
        bort igen, och ändrar ingenting i din egen.
      </p>
      <p>
        <button
          type="button"
          className="knapp knapp--text"
          disabled={arbetar}
          data-testid="valkomst-exempel"
          onClick={() => {
            setArbetar(true);
            onExempel().catch((orsak: unknown) => {
              setFel(orsak instanceof Error ? orsak.message : String(orsak));
              setArbetar(false);
            });
          }}
        >
          Öppna en exempelbok
        </button>
      </p>

      <h3>Har du använt Bokfink förut?</h3>
      <p>
        <button
          type="button"
          className="knapp knapp--text"
          data-testid="valkomst-aterstall"
          onClick={() => void onAterstall()}
        >
          Läs in en säkerhetskopia
        </button>
      </p>
    </section>
  );
}
