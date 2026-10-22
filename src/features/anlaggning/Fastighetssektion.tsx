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

interface Props {
  readonly fastigheter: readonly Fastighetstillgang[];
  readonly idag: Datum;
  readonly onRegistrera: (uppgifter: {
    readonly benamning: string;
    readonly anskaffningsdatum: Datum;
    readonly anskaffningsvarde: Ore;
    readonly kategori: Fastighetskategori;
  }) => Promise<string>;
  readonly onAvyttra: (
    id: Uuid,
    avyttring: {
      readonly datum: Datum;
      readonly typ: 'forsaljning' | 'utrangering';
      readonly forsaljningsinkomst: Ore;
    },
  ) => Promise<string>;
  readonly onBokforAvskrivning: (
    id: Uuid,
    belopp: Ore,
    avskrivningskostnadKonto: ReturnType<typeof kontonummer>,
    ackAvskrivningKonto: ReturnType<typeof kontonummer>,
  ) => Promise<string>;
}

type Kategorival = 'byggnad' | 'markanlaggning' | 'mark' | 'skog';

/**
 * Byggnader, markanläggningar, mark och skog - varje sak skriver av sig
 * själv (BFN K1 punkt 6.14-6.24), till skillnad från den kollektiva potten
 * ovanför. Ackumulerad avskrivning lever i registret självt (se
 * fastighetstillgang.ts), så förslaget här behöver ingen liggarläsning
 * - det räcker att titta på tillgången.
 */
export function Fastighetssektion({
  fastigheter,
  idag,
  onRegistrera,
  onAvyttra,
  onBokforAvskrivning,
}: Props) {
  const [benamning, setBenamning] = useState('');
  const [anskaffningsdatum, setAnskaffningsdatum] = useState(idag);
  const [belopp, setBelopp] = useState('');
  const [kategorival, setKategorival] = useState<Kategorival>('byggnad');
  const [byggnadstyp, setByggnadstyp] = useState<Byggnadstyp>('ekonomibyggnad_ovrig');
  const [markanlaggningstyp, setMarkanlaggningstyp] =
    useState<Markanlaggningstyp>('ovrig');

  const [oppen, setOppen] = useState<string | undefined>();
  const [avyttringstyp, setAvyttringstyp] = useState<'forsaljning' | 'utrangering'>(
    'forsaljning',
  );
  const [avyttringsbelopp, setAvyttringsbelopp] = useState('');
  const [avyttringsdatum, setAvyttringsdatum] = useState(idag);
  const [kostnadskontoText, setKostnadskontoText] = useState('7820');
  const [ackkontoText, setAckkontoText] = useState('1129');

  const [arbetar, setArbetar] = useState(false);
  const [besked, setBesked] = useState<string | undefined>();
  const [fel, setFel] = useState<string | undefined>();

  async function kor(uppgift: () => Promise<string>) {
    setArbetar(true);
    setBesked(undefined);
    setFel(undefined);
    try {
      setBesked(await uppgift());
    } catch (orsak) {
      // Hard rule 11: shown, not swallowed.
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setArbetar(false);
    }
  }

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
    <section aria-label="Fastighetskomponenter">
      <h2>Byggnader, markanläggningar, mark och skog</h2>

      <p className="hjalptext">
        Här skrivs varje sak av för sig, med sin egen procentsats - till skillnad från
        maskiner och inventarier ovan. Mark och skog skrivs aldrig av.
      </p>

      {fastigheter.length === 0 ? (
        <p className="tomt" data-testid="inga-fastigheter">
          Inget är registrerat ännu.
        </p>
      ) : (
        <ul className="lista" data-testid="fastighetslista">
          {fastigheter.map((tillgang) => {
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
                      {tillgang.avyttring !== undefined &&
                        ` · ${tillgang.avyttring.typ === 'forsaljning' ? 'Sålt' : 'Utrangerat'} ${tillgang.avyttring.datum}`}
                    </span>
                  </span>
                  <span className="belopp">
                    {formatKronor(tillgang.anskaffningsvarde)}
                  </span>
                </button>

                {visas && tillgang.avyttring === undefined && (
                  <div className="kort" data-testid={`fastighet-detalj-${tillgang.id}`}>
                    <dl>
                      <dt>Ackumulerad avskrivning</dt>
                      <dd>{formatKronor(tillgang.ackumuleradAvskrivning)}</dd>
                      <dt>Årets föreslagna avskrivning</dt>
                      <dd>{formatKronor(forslag)}</dd>
                    </dl>

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

      <h3>Ny fastighetskomponent</h3>

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

      <div className="faltgrupp">
        <label htmlFor="fastighet-kategori">Typ</label>
        <select
          id="fastighet-kategori"
          className="falt"
          value={kategorival}
          onChange={(handelse) => setKategorival(handelse.target.value as Kategorival)}
        >
          <option value="byggnad">Byggnad</option>
          <option value="markanlaggning">Markanläggning</option>
          <option value="mark">Mark</option>
          <option value="skog">Skog</option>
        </select>
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
            });
            setBenamning('');
            setBelopp('');
            return resultat;
          })
        }
      >
        Registrera
      </button>

      {arbetar && <p data-testid="fastighet-arbetar">Arbetar …</p>}

      {besked !== undefined && (
        <p className="kort" role="status" data-testid="fastighet-besked">
          {besked}
        </p>
      )}

      {fel !== undefined && (
        <p role="alert" data-testid="fastighet-fel">
          {fel}
        </p>
      )}
    </section>
  );
}
