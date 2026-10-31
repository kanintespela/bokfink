import { useMemo, useState } from 'react';

import { kronorString } from '../../domain/belopp/ore';
import type { Uuid } from '../../domain/id/uuidv7';
import { kontonummer, type Konto, type Kontonummer } from '../../domain/konto/konto';
import {
  LANGSTA_PROJEKTKOD,
  LANGSTA_PROJEKTNAMN,
  type Budgetpost,
  type Projekt,
} from '../../domain/projekt/projekt';
import { Tillbaka } from '../../ui/Tillbaka';
import { tolkaBelopp } from '../bokfor/Beloppsfalt';
import { Uppgiftsstatus, useUppgift } from '../data/uppgift';

interface Props {
  readonly projekt: readonly Projekt[];
  /** For naming the accounts of a budget and checking that they exist. */
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly onTillbaka: () => void;
  readonly onSkapa: (uppgifter: { kod: string; namn: string }) => Promise<void>;
  readonly onAndra: (
    id: Uuid,
    andring: {
      readonly namn?: string;
      readonly avslutat?: boolean;
      readonly budget?: readonly Budgetpost[];
    },
  ) => Promise<void>;
}

interface Budgetrad {
  readonly konto: string;
  readonly belopp: string;
}

const TOM_BUDGETRAD: Budgetrad = { konto: '', belopp: '' };

/**
 * The projects a rad can be booked on: a code and a name each.
 *
 * Kept as a list of its own rather than typed into a field on the form, so
 * that "LEADER-28" and "Leader 28" cannot become two projects in a report.
 * The code is what a file calls the project and is fixed once given; the
 * name can be changed, and a project that is over is finished, not removed -
 * what was booked on it stays, and it can be reopened.
 */
export function Projektsida({ projekt, konton, onTillbaka, onSkapa, onAndra }: Props) {
  const [kod, setKod] = useState('');
  const [namn, setNamn] = useState('');
  /** The project being renamed, and what its name is being changed to. */
  const [byterNamn, setByterNamn] = useState<{ id: Uuid; namn: string } | undefined>();
  /** The project whose budget is being set, and the lines typed so far. */
  const [budgeterar, setBudgeterar] = useState<
    { id: Uuid; rader: readonly Budgetrad[] } | undefined
  >();
  const { arbetar, besked, fel, kor } = useUppgift();

  const sorterade = useMemo(
    () =>
      [...projekt].sort(
        (a, b) =>
          Number(a.avslutat) - Number(b.avslutat) || a.kod.localeCompare(b.kod, 'sv'),
      ),
    [projekt],
  );

  return (
    <section aria-label="Projekt">
      <Tillbaka onTillbaka={onTillbaka} />
      <h2>Projekt</h2>
      <p className="hjalptext">
        Ett projekt är till exempel ett bidrag eller ett arrangemang som du vill kunna
        följa för sig. På en rad i ett verifikat kan du välja ett projekt, men du behöver
        inte. Koden kan inte ändras efteråt, eftersom den är projektets namn i de filer
        som lämnar appen; namnet kan du ändra.
      </p>

      {sorterade.length === 0 ? (
        <p className="tomt" data-testid="inga-projekt">
          Inga projekt än.
        </p>
      ) : (
        <ul className="lista" data-testid="projektlista">
          {sorterade.map((post) => (
            <li key={post.id}>
              <div className="listrad">
                <span className="listrad__text">
                  <span>
                    {post.kod} {post.namn}
                  </span>
                  <span className="listrad__sekundar">
                    {post.avslutat ? 'Avslutat' : 'Pågår'}
                    {post.budget !== undefined &&
                      post.budget.length > 0 &&
                      ` · budget på ${post.budget.length} ${post.budget.length === 1 ? 'konto' : 'konton'}`}
                  </span>
                </span>
                <button
                  type="button"
                  className="knapp knapp--text"
                  disabled={arbetar}
                  data-testid={`byt-namn-${post.kod}`}
                  onClick={() => setByterNamn({ id: post.id, namn: post.namn })}
                >
                  Byt namn
                </button>
                <button
                  type="button"
                  className="knapp knapp--text"
                  disabled={arbetar}
                  data-testid={`budget-${post.kod}`}
                  onClick={() =>
                    setBudgeterar({
                      id: post.id,
                      rader:
                        post.budget === undefined || post.budget.length === 0
                          ? [TOM_BUDGETRAD]
                          : post.budget.map((rad) => ({
                              konto: rad.konto,
                              belopp: kronorString(rad.belopp).replace('.', ','),
                            })),
                    })
                  }
                >
                  Budget
                </button>
                <button
                  type="button"
                  className="knapp knapp--text"
                  disabled={arbetar}
                  data-testid={`${post.avslutat ? 'oppna' : 'avsluta'}-${post.kod}`}
                  onClick={() =>
                    void kor(async () => {
                      await onAndra(post.id, { avslutat: !post.avslutat });
                      return post.avslutat
                        ? `${post.kod} är öppnat igen.`
                        : `${post.kod} är avslutat. Det som är bokfört på det ligger kvar, men det tar inga nya rader.`;
                    })
                  }
                >
                  {post.avslutat ? 'Öppna igen' : 'Avsluta'}
                </button>
              </div>
              {budgeterar?.id === post.id && (
                <div className="kort" data-testid="budgetformular">
                  <p className="hjalptext">
                    Vad projektet väntas ge och kosta, för hela projektet. Skriv intäkter
                    (konto 3xxx) och kostnader (konto 4xxx–7xxx) som vanliga positiva
                    belopp. Det som skrivs här ersätter den budget som fanns.
                  </p>
                  {budgeterar.rader.map((rad, index) => {
                    const nummer = rad.konto.trim();
                    const namn = konton.get(nummer as Kontonummer)?.namn;
                    return (
                      <div key={index} className="faltgrupp">
                        <label htmlFor={`budget-konto-${index}`}>
                          Konto, budgetrad {index + 1}
                        </label>
                        <input
                          id={`budget-konto-${index}`}
                          className="falt"
                          inputMode="numeric"
                          autoComplete="off"
                          value={rad.konto}
                          onChange={(handelse) =>
                            setBudgeterar({
                              id: post.id,
                              rader: budgeterar.rader.map((kandidat, plats) =>
                                plats === index
                                  ? { ...kandidat, konto: handelse.target.value }
                                  : kandidat,
                              ),
                            })
                          }
                        />
                        <span className="listrad__sekundar">
                          {nummer === ''
                            ? ' '
                            : (namn ?? 'Kontot finns inte i kontoplanen.')}
                        </span>
                        <label htmlFor={`budget-belopp-${index}`}>
                          Belopp, budgetrad {index + 1}
                        </label>
                        <input
                          id={`budget-belopp-${index}`}
                          className="falt"
                          inputMode="decimal"
                          value={rad.belopp}
                          onChange={(handelse) =>
                            setBudgeterar({
                              id: post.id,
                              rader: budgeterar.rader.map((kandidat, plats) =>
                                plats === index
                                  ? { ...kandidat, belopp: handelse.target.value }
                                  : kandidat,
                              ),
                            })
                          }
                        />
                        {budgeterar.rader.length > 1 && (
                          <button
                            type="button"
                            className="knapp knapp--text"
                            onClick={() =>
                              setBudgeterar({
                                id: post.id,
                                rader: budgeterar.rader.filter(
                                  (_, plats) => plats !== index,
                                ),
                              })
                            }
                          >
                            Ta bort rad {index + 1}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="knapp knapp--text"
                    data-testid="budget-ny-rad"
                    onClick={() =>
                      setBudgeterar({
                        id: post.id,
                        rader: [...budgeterar.rader, TOM_BUDGETRAD],
                      })
                    }
                  >
                    Lägg till rad
                  </button>
                  <button
                    type="button"
                    className="knapp knapp--primar"
                    disabled={arbetar}
                    data-testid="spara-budget"
                    onClick={() =>
                      void kor(async () => {
                        const budget = tillBudget(budgeterar.rader, konton);
                        await onAndra(post.id, { budget });
                        setBudgeterar(undefined);
                        return budget.length === 0
                          ? `Budgeten för ${post.kod} är borttagen.`
                          : `Budgeten för ${post.kod} är sparad.`;
                      })
                    }
                  >
                    Spara budgeten
                  </button>
                  <button
                    type="button"
                    className="knapp knapp--text"
                    onClick={() => setBudgeterar(undefined)}
                  >
                    Avbryt
                  </button>
                </div>
              )}
              {byterNamn?.id === post.id && (
                <div className="faltgrupp">
                  <label htmlFor="projekt-nytt-namn">Nytt namn för {post.kod}</label>
                  <input
                    id="projekt-nytt-namn"
                    className="falt"
                    maxLength={LANGSTA_PROJEKTNAMN}
                    value={byterNamn.namn}
                    onChange={(handelse) =>
                      setByterNamn({ id: post.id, namn: handelse.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="knapp"
                    disabled={arbetar}
                    data-testid="spara-projektnamn"
                    onClick={() =>
                      void kor(async () => {
                        await onAndra(post.id, { namn: byterNamn.namn });
                        setByterNamn(undefined);
                        return `${post.kod} heter nu ${byterNamn.namn.trim()}.`;
                      })
                    }
                  >
                    Spara namnet
                  </button>
                  <button
                    type="button"
                    className="knapp knapp--text"
                    onClick={() => setByterNamn(undefined)}
                  >
                    Avbryt
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>Nytt projekt</h3>

      <div className="faltgrupp">
        <label htmlFor="projekt-kod">Kod</label>
        <input
          id="projekt-kod"
          className="falt"
          autoComplete="off"
          placeholder="LEADER-28"
          maxLength={LANGSTA_PROJEKTKOD}
          value={kod}
          onChange={(handelse) => setKod(handelse.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="projekt-namn">Namn</label>
        <input
          id="projekt-namn"
          className="falt"
          autoComplete="off"
          placeholder="Ny scen vid badplatsen"
          maxLength={LANGSTA_PROJEKTNAMN}
          value={namn}
          onChange={(handelse) => setNamn(handelse.target.value)}
        />
      </div>

      <button
        type="button"
        className="knapp knapp--primar"
        disabled={arbetar || kod.trim() === '' || namn.trim() === ''}
        data-testid="skapa-projekt"
        onClick={() =>
          void kor(async () => {
            await onSkapa({ kod, namn });
            setKod('');
            setNamn('');
            return `Projektet ${kod.trim()} är skapat.`;
          })
        }
      >
        Skapa projekt
      </button>

      <Uppgiftsstatus arbetar={arbetar} besked={besked} fel={fel} />
    </section>
  );
}

/**
 * The budget lines that were typed, as a budget. A row left empty is skipped,
 * so a spare row costs nothing and an empty form takes the budget away; a row
 * half filled in, or on an account the kontoplan lacks, is refused by name.
 */
function tillBudget(
  rader: readonly Budgetrad[],
  konton: ReadonlyMap<Kontonummer, Konto>,
): Budgetpost[] {
  const poster: Budgetpost[] = [];
  rader.forEach((rad, index) => {
    const text = rad.konto.trim();
    if (text === '' && rad.belopp.trim() === '') {
      return;
    }
    const namn = `Budgetrad ${index + 1}`;
    if (text === '') {
      throw new TypeError(`${namn} har ett belopp men saknar konto.`);
    }
    const konto = kontonummer(text);
    if (!konton.has(konto)) {
      throw new TypeError(`${namn}: konto ${konto} finns inte i kontoplanen.`);
    }
    const belopp = tolkaBelopp(rad.belopp);
    if (belopp === undefined) {
      throw new TypeError(`${namn}: skriv beloppet för konto ${konto}.`);
    }
    poster.push({ konto, belopp });
  });
  return poster;
}
