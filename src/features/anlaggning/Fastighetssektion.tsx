import { useState } from 'react';

import {
  arligAvskrivningsprocent,
  arsAvskrivning,
  bokfortVarde,
  type Fastighetskategori,
  type Fastighetstillgang,
} from '../../domain/anlaggning/fastighetstillgang';
import {
  BYGGNADSTYP_NAMN,
  MARKANLAGGNINGSTYP_NAMN,
  type Byggnadstyp,
  type Markanlaggningstyp,
} from '../../domain/anlaggning/byggnadsprocentsatser';
import { formatKronor, oreFromKronor, type Ore } from '../../domain/belopp/ore';
import { kontonummer } from '../../domain/konto/konto';
import type { Datum } from '../../domain/tid/datum';
import type { Uuid } from '../../domain/id/uuidv7';
import { Bekraftaknapp } from '../../ui/Bekraftaknapp';
import { kopt } from './Oregistreradekop';

type Kategorival = 'byggnad' | 'markanlaggning' | 'mark' | 'skog';

/** What the page's single "Lägg till" form passes down, and what the list props share. */
export type Fastighetstyp = Kategorival;

interface Samband {
  /** Runs an action and says how it went, once, at the top of the page. */
  readonly kor: (uppgift: () => Promise<string>) => Promise<void>;
  readonly arbetar: boolean;
}

interface ListProps extends Samband {
  /** What is owned. A sold or scrapped entry belongs in the section for those. */
  readonly fastigheter: readonly Fastighetstillgang[];
  readonly idag: Datum;
  readonly onAvyttra: (
    id: Uuid,
    avyttring: {
      readonly datum: Datum;
      readonly typ: 'forsaljning' | 'utrangering';
      readonly forsaljningsinkomst: Ore;
    },
  ) => Promise<string>;
  /** Takes the entry out of the register; only offered for one with nothing written off. */
  readonly onMakulera: (id: Uuid) => Promise<string>;
  readonly onBokforAvskrivning: (
    id: Uuid,
    belopp: Ore,
    avskrivningskostnadKonto: ReturnType<typeof kontonummer>,
    ackAvskrivningKonto: ReturnType<typeof kontonummer>,
  ) => Promise<string>;
  /** The accounts offered to start with, which depend on what kind of book this is. */
  readonly standardkonton: { readonly kostnad: string; readonly ack: string };
  readonly verifikatnamn: ReadonlyMap<Uuid, string>;
  /** An association has no collective pool above this section to be told apart from. */
  readonly forening: boolean;
}

/**
 * Byggnader, markanläggningar, mark och skog som ägs - varje sak skriver av
 * sig själv (BFN K1 punkt 6.14-6.24), till skillnad från den kollektiva
 * potten. Ackumulerad avskrivning lever i registret självt (se
 * fastighetstillgang.ts), så förslaget här behöver ingen liggarläsning
 * - det räcker att titta på tillgången.
 */
export function Fastighetslista({
  standardkonton,
  verifikatnamn,
  forening,
  fastigheter,
  idag,
  onAvyttra,
  onMakulera,
  onBokforAvskrivning,
  kor,
  arbetar,
}: ListProps) {
  const agda = fastigheter.filter((tillgang) => tillgang.avyttring === undefined);
  const [oppen, setOppen] = useState<string | undefined>();
  const [avyttringstyp, setAvyttringstyp] = useState<'forsaljning' | 'utrangering'>(
    'forsaljning',
  );
  const [avyttringsbelopp, setAvyttringsbelopp] = useState('');
  const [avyttringsdatum, setAvyttringsdatum] = useState(idag);
  const [kostnadskontoText, setKostnadskontoText] = useState(standardkonton.kostnad);
  const [ackkontoText, setAckkontoText] = useState(standardkonton.ack);

  return (
    <section aria-label="Byggnader och mark">
      <h3>Byggnader och mark</h3>

      <p className="hjalptext">
        Byggnader, markanläggningar, mark och skog. Varje sak skrivs av för sig, med sin
        egen procentsats
        {forening ? '' : ' - till skillnad från maskiner och inventarier'}. Mark och skog
        skrivs aldrig av.
      </p>

      {agda.length === 0 ? (
        <p className="tomt" data-testid="inga-fastigheter">
          Inget är registrerat ännu.
        </p>
      ) : (
        <ul className="lista" data-testid="fastighetslista">
          {agda.map((tillgang) => {
            const visas = oppen === tillgang.id;
            const forslag = arsAvskrivning(tillgang, tillgang.ackumuleradAvskrivning);
            const vardeNu = bokfortVarde(tillgang, tillgang.ackumuleradAvskrivning);
            return (
              <li key={tillgang.id}>
                <button
                  type="button"
                  className="listrad"
                  aria-expanded={visas}
                  onClick={() => setOppen(visas ? undefined : tillgang.id)}
                >
                  <span className="listrad__text">
                    <span>{tillgang.benamning}</span>
                    <span className="listrad__sekundar">
                      {arligAvskrivningsprocent(tillgang.kategori)} % · Bokfört värde{' '}
                      {formatKronor(vardeNu)}
                      {kopt(tillgang.verifikatId, verifikatnamn)}
                    </span>
                  </span>
                  <span className="belopp">
                    {formatKronor(tillgang.anskaffningsvarde)}
                  </span>
                </button>

                {visas && (
                  <div className="kort" data-testid={`fastighet-detalj-${tillgang.id}`}>
                    <dl>
                      <dt>Ackumulerad avskrivning</dt>
                      <dd>{formatKronor(tillgang.ackumuleradAvskrivning)}</dd>
                      <dt>Årets föreslagna avskrivning</dt>
                      <dd>{formatKronor(forslag)}</dd>
                    </dl>

                    {tillgang.ackumuleradAvskrivning === 0 ? (
                      <p>
                        <Bekraftaknapp
                          testId={`makulera-fastighet-${tillgang.id}`}
                          fraga={`Ta bort ${tillgang.benamning} ur registret? Den finns kvar i loggen men syns inte längre här.`}
                          jaText="Ta bort"
                          disabled={arbetar}
                          onBekrafta={() => void kor(async () => onMakulera(tillgang.id))}
                        >
                          Ta bort ur registret
                        </Bekraftaknapp>
                      </p>
                    ) : (
                      <p className="hjalptext">
                        Posten har avskrivningar och kan inte tas bort ur registret.
                      </p>
                    )}

                    {forslag > 0 && (
                      <>
                        <div className="faltgrupp">
                          <label htmlFor={`kostnadskonto-${tillgang.id}`}>
                            Kostnadskonto för avskrivningen
                          </label>
                          <input
                            id={`kostnadskonto-${tillgang.id}`}
                            className="falt"
                            value={kostnadskontoText}
                            onChange={(handelse) =>
                              setKostnadskontoText(handelse.target.value)
                            }
                          />
                        </div>
                        <div className="faltgrupp">
                          <label htmlFor={`ackkonto-${tillgang.id}`}>
                            Kontot för ackumulerade avskrivningar
                          </label>
                          <input
                            id={`ackkonto-${tillgang.id}`}
                            className="falt"
                            value={ackkontoText}
                            onChange={(handelse) =>
                              setAckkontoText(handelse.target.value)
                            }
                          />
                        </div>
                        <button
                          type="button"
                          className="knapp knapp--primar"
                          disabled={arbetar}
                          data-testid={`bokfor-fastighet-${tillgang.id}`}
                          onClick={() =>
                            void kor(async () =>
                              onBokforAvskrivning(
                                tillgang.id,
                                forslag,
                                kontonummer(kostnadskontoText),
                                kontonummer(ackkontoText),
                              ),
                            )
                          }
                        >
                          Bokför {formatKronor(forslag)} kr
                        </button>
                      </>
                    )}

                    <div className="segment">
                      <button
                        type="button"
                        aria-pressed={avyttringstyp === 'forsaljning'}
                        onClick={() => setAvyttringstyp('forsaljning')}
                      >
                        Sålt
                      </button>
                      <button
                        type="button"
                        aria-pressed={avyttringstyp === 'utrangering'}
                        onClick={() => setAvyttringstyp('utrangering')}
                      >
                        Utrangerat
                      </button>
                    </div>

                    <div className="faltgrupp">
                      <label htmlFor="fastighet-avyttringsdatum">Datum</label>
                      <input
                        id="fastighet-avyttringsdatum"
                        className="falt"
                        type="date"
                        value={avyttringsdatum}
                        onChange={(handelse) =>
                          setAvyttringsdatum(handelse.target.value as Datum)
                        }
                      />
                    </div>

                    {avyttringstyp === 'forsaljning' && (
                      <div className="faltgrupp">
                        <label htmlFor="fastighet-avyttringsbelopp">
                          Försäljningsinkomst
                        </label>
                        <input
                          id="fastighet-avyttringsbelopp"
                          className="falt"
                          inputMode="decimal"
                          value={avyttringsbelopp}
                          onChange={(handelse) =>
                            setAvyttringsbelopp(handelse.target.value)
                          }
                        />
                      </div>
                    )}

                    <button
                      type="button"
                      className="knapp"
                      disabled={arbetar}
                      data-testid={`bekrafta-avyttring-fastighet-${tillgang.id}`}
                      onClick={() =>
                        void kor(async () => {
                          const inkomst =
                            avyttringstyp === 'forsaljning' &&
                            avyttringsbelopp.trim() !== ''
                              ? oreFromKronor(avyttringsbelopp)
                              : oreFromKronor('0');
                          const resultat = await onAvyttra(tillgang.id, {
                            datum: avyttringsdatum,
                            typ: avyttringstyp,
                            forsaljningsinkomst: inkomst,
                          });
                          setAvyttringsbelopp('');
                          return resultat;
                        })
                      }
                    >
                      {avyttringstyp === 'forsaljning'
                        ? 'Registrera försäljning'
                        : 'Registrera utrangering'}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface FormProps extends Samband {
  readonly typ: Kategorival;
  readonly idag: Datum;
  readonly onRegistrera: (uppgifter: {
    readonly benamning: string;
    readonly anskaffningsdatum: Datum;
    readonly anskaffningsvarde: Ore;
    readonly kategori: Fastighetskategori;
    readonly ackumuleradAvskrivning?: Ore;
  }) => Promise<string>;
  /** Called once the entry is saved, so the page can fold the form away. */
  readonly onKlar: () => void;
}

/** The fields for a new building, markanläggning, mark or skog. The page picks which. */
export function Fastighetsformular({
  typ: kategorival,
  idag,
  onRegistrera,
  onKlar,
  kor,
  arbetar,
}: FormProps) {
  const [benamning, setBenamning] = useState('');
  const [anskaffningsdatum, setAnskaffningsdatum] = useState(idag);
  const [belopp, setBelopp] = useState('');
  const [redanAvskrivet, setRedanAvskrivet] = useState('');
  const [byggnadstyp, setByggnadstyp] = useState<Byggnadstyp>('ekonomibyggnad_ovrig');
  const [markanlaggningstyp, setMarkanlaggningstyp] =
    useState<Markanlaggningstyp>('ovrig');

  const beloppOre = (() => {
    try {
      return belopp.trim() === '' ? undefined : oreFromKronor(belopp);
    } catch {
      return undefined;
    }
  })();

  const kategori: Fastighetskategori =
    kategorival === 'byggnad'
      ? { typ: 'byggnad', byggnadstyp }
      : kategorival === 'markanlaggning'
        ? { typ: 'markanlaggning', markanlaggningstyp }
        : { typ: kategorival };

  return (
    <>
      <div className="faltgrupp">
        <label htmlFor="fastighet-benamning">Komponentens benämning</label>
        <input
          id="fastighet-benamning"
          className="falt"
          value={benamning}
          onChange={(handelse) => setBenamning(handelse.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="fastighet-datum">Komponentens anskaffningsdatum</label>
        <input
          id="fastighet-datum"
          className="falt"
          type="date"
          value={anskaffningsdatum}
          onChange={(handelse) => setAnskaffningsdatum(handelse.target.value as Datum)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="fastighet-belopp">Komponentens anskaffningsvärde</label>
        <input
          id="fastighet-belopp"
          className="falt"
          inputMode="decimal"
          value={belopp}
          onChange={(handelse) => setBelopp(handelse.target.value)}
        />
      </div>

      {/*
       * For something owned before the register was set up here. Without it
       * the register would start an old building at its full cost, and the
       * bokfört värde would differ from the ledger's by everything written
       * off so far. Left blank for something just bought.
       */}
      <div className="faltgrupp">
        <label htmlFor="fastighet-redan-avskrivet">Redan avskrivet (valfritt)</label>
        <input
          id="fastighet-redan-avskrivet"
          className="falt"
          inputMode="decimal"
          value={redanAvskrivet}
          onChange={(handelse) => setRedanAvskrivet(handelse.target.value)}
        />
        <p className="hjalptext">
          Fyll i för en tillgång som har skrivits av tidigare år: summan av de
          avskrivningar som redan är bokförda på den. Lämna tomt för något nyköpt.
        </p>
      </div>

      {kategorival === 'byggnad' && (
        <div className="faltgrupp">
          <label htmlFor="fastighet-byggnadstyp">Byggnadstyp</label>
          <select
            id="fastighet-byggnadstyp"
            className="falt"
            value={byggnadstyp}
            onChange={(handelse) => setByggnadstyp(handelse.target.value as Byggnadstyp)}
          >
            {Object.entries(BYGGNADSTYP_NAMN).map(([varde, namn]) => (
              <option key={varde} value={varde}>
                {namn}
              </option>
            ))}
          </select>
        </div>
      )}

      {kategorival === 'markanlaggning' && (
        <div className="faltgrupp">
          <label htmlFor="fastighet-markanlaggningstyp">Markanläggningstyp</label>
          <select
            id="fastighet-markanlaggningstyp"
            className="falt"
            value={markanlaggningstyp}
            onChange={(handelse) =>
              setMarkanlaggningstyp(handelse.target.value as Markanlaggningstyp)
            }
          >
            {Object.entries(MARKANLAGGNINGSTYP_NAMN).map(([varde, namn]) => (
              <option key={varde} value={varde}>
                {namn}
              </option>
            ))}
          </select>
        </div>
      )}

      <button
        type="button"
        className="knapp knapp--primar"
        disabled={arbetar || benamning.trim() === '' || beloppOre === undefined}
        data-testid="registrera-fastighet"
        onClick={() =>
          void kor(async () => {
            const resultat = await onRegistrera({
              benamning,
              anskaffningsdatum,
              anskaffningsvarde: beloppOre!,
              kategori,
              ...(redanAvskrivet.trim() === ''
                ? {}
                : { ackumuleradAvskrivning: oreFromKronor(redanAvskrivet) }),
            });
            setBenamning('');
            setBelopp('');
            setRedanAvskrivet('');
            onKlar();
            return resultat;
          })
        }
      >
        Registrera
      </button>
    </>
  );
}
