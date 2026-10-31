import { useState } from 'react';

import { type Bokprofil, harFunktion } from '../../domain/bok/bokprofil';
import { VYNAMN, type Vy } from '../../ui/vy';

/**
 * Everything that is not done every week, in one place.
 *
 * The bookkeeping apps people already know - Bokio, Fortnox, Spiris - keep
 * the bottom bar for the few things done all the time and put the rest
 * behind a "Mer". That is what this is: the quarterly, the yearly and the
 * set-once, grouped by when they come up rather than by how they are built.
 * Before it, the same links were stacked under the start view's to-do list,
 * and the start view stopped being an answer to "is there anything to do?".
 */
const GRUPPER: readonly { readonly rubrik: string; readonly vyer: readonly Vy[] }[] = [
  { rubrik: 'Löpande', vyer: ['moms', 'rapporter', 'bank'] },
  {
    rubrik: 'Bokslut',
    vyer: ['periodisering', 'egetkapital', 'arsbokslut', 'nebilaga'],
  },
  { rubrik: 'Register', vyer: ['anlaggning', 'lager', 'projekt'] },
  {
    rubrik: 'Inställningar',
    vyer: [
      'foretag',
      'rakenskapsar',
      'konton',
      'sakerhetskopia',
      'enhet',
      'filer',
      'bocker',
    ],
  },
];

interface Props {
  readonly onValj: (vy: Vy) => void;
  /** Views this kind of book has no use for, which are left out. */
  readonly dolda: ReadonlySet<Vy>;
  readonly profil: Bokprofil;
  readonly momsregistrerad: boolean;
  /** Shares the coming deadlines as a calendar file and says what happened. */
  readonly onKalender: () => Promise<string>;
}

export function Mer({ onValj, dolda, profil, momsregistrerad, onKalender }: Props) {
  const [arbetar, setArbetar] = useState(false);
  const [besked, setBesked] = useState<string | undefined>();
  const [fel, setFel] = useState<string | undefined>();

  async function exporteraKalender() {
    setArbetar(true);
    setBesked(undefined);
    setFel(undefined);
    try {
      setBesked(await onKalender());
    } catch (orsak) {
      // Hard rule 11: shown, not swallowed.
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setArbetar(false);
    }
  }

  return (
    <section aria-label="Mer">
      <h2>Mer</h2>

      {GRUPPER.map(({ rubrik, vyer: alla }) => {
        const vyer = alla.filter((vy) => !dolda.has(vy));
        return (
          <div key={rubrik}>
            <h3>{rubrik}</h3>
            <ul className="lista">
              {vyer.map((vy) => (
                <li key={vy}>
                  <button type="button" className="listrad" onClick={() => onValj(vy)}>
                    {VYNAMN[vy]}
                  </button>
                </li>
              ))}
              {rubrik === 'Löpande' && (
                <li>
                  <button
                    type="button"
                    className="listrad"
                    disabled={arbetar}
                    data-testid="exportera-kalender"
                    onClick={() => void exporteraKalender()}
                  >
                    <span className="listrad__text">
                      <span>Lägg in datumen i kalendern</span>
                      <span className="listrad__sekundar">
                        {kalenderbeskrivning(profil, momsregistrerad)}
                      </span>
                    </span>
                  </button>
                </li>
              )}
            </ul>
            {rubrik === 'Löpande' && besked !== undefined && (
              <p className="hjalptext" role="status" data-testid="kalender-besked">
                {besked}
              </p>
            )}
            {rubrik === 'Löpande' && fel !== undefined && (
              <p role="alert" data-testid="kalender-fel">
                {fel}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** What the calendar file holds, which depends on what the book has dates for. */
function kalenderbeskrivning(profil: Bokprofil, momsregistrerad: boolean): string {
  const delar = [
    ...(momsregistrerad ? ['moms'] : []),
    ...(harFunktion(profil, 'inkomstdeklarationsdag') ? ['inkomstdeklaration'] : []),
    'fakturor',
  ];
  const text =
    delar.length === 1
      ? 'Fakturor'
      : `${delar.slice(0, -1).join(', ')} och ${delar.at(-1)}`;
  return `${text[0]?.toUpperCase()}${text.slice(1)}, med påminnelse en vecka före`;
}
