import type { Momsperiod } from '../../domain/moms/period';
import {
  METODBESKRIVNING,
  METODNAMN,
  type Redovisningsmetod,
} from '../../domain/moms/redovisningsmetod';
import { PERIODNAMN } from '../moms/namn';

interface Props {
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
  organisationsnummer,
  onOrganisationsnummer,
  momsperiod,
  onMomsperiod,
  metod,
  onMetod,
}: Props) {
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
          onChange={(handelse) => void onOrganisationsnummer(handelse.target.value)}
        />
      </div>

      <p>
        För enskild firma är det innehavarens personnummer, med eller utan sekelsiffror.
        Det behövs bara för momsdeklarationen och lämnar aldrig enheten.
      </p>

      <div className="faltgrupp">
        <label htmlFor="momsperiod">Redovisningsperiod för moms</label>
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
