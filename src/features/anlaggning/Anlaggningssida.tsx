import { useState } from 'react';

import { kravsDirektavdrag } from '../../domain/anlaggning/anlaggningstillgang';
import type { Anlaggningstillgang } from '../../domain/anlaggning/anlaggningstillgang';
import type {
  Fastighetskategori,
  Fastighetstillgang,
} from '../../domain/anlaggning/fastighetstillgang';
import type { Arsavskrivningsunderlag } from '../../data/anlaggning';
import { formatKronor, oreFromKronor, type Ore } from '../../domain/belopp/ore';
import { kontonummer, type Kontonummer } from '../../domain/konto/konto';
import type { Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import { delar, type Datum } from '../../domain/tid/datum';
import { halvtPrisbasbelopp as halvtPrisbasbeloppFor } from '../../domain/skatt/skattetabell';
import type { Uuid } from '../../domain/id/uuidv7';
import { Tillbaka } from '../../ui/Tillbaka';
import { Fastighetssektion } from './Fastighetssektion';
import { Prisbasbeloppssektion } from './Prisbasbeloppssektion';

interface Props {
  readonly onTillbaka: () => void;
  readonly rakenskapsar: readonly Rakenskapsar[];
  readonly anlaggningar: readonly Anlaggningstillgang[];
  readonly fastigheter: readonly Fastighetstillgang[];
  readonly idag: Datum;
  /** Prisbasbelopp the owner has added for years the app does not know. */
  readonly egnaPrisbasbelopp: ReadonlyMap<number, Ore>;
  readonly onHamtaPrisbasbelopp: (ar: number) => Promise<Ore>;
  readonly onSparaPrisbasbelopp: (ar: number, belopp: Ore) => Promise<void>;
  readonly onRegistrera: (uppgifter: {
    readonly benamning: string;
    readonly anskaffningsdatum: Datum;
    readonly anskaffningsvarde: Ore;
    readonly nyttjandeperiod: number;
  }) => Promise<string>;
  readonly onAvyttra: (
    id: Uuid,
    avyttring: {
      readonly datum: Datum;
      readonly typ: 'forsaljning' | 'utrangering';
      readonly forsaljningsinkomst: Ore;
    },
  ) => Promise<string>;
  readonly onBeraknaAvskrivning: (
    rakenskapsarId: Uuid,
    poolkonton: readonly Kontonummer[],
  ) => Promise<Arsavskrivningsunderlag>;
  readonly onBokforAvskrivning: (
    rakenskapsarId: Uuid,
    belopp: Ore,
    avskrivningskostnadKonto: Kontonummer,
    ackAvskrivningKonto: Kontonummer,
  ) => Promise<string>;
  readonly onRegistreraFastighet: (uppgifter: {
    readonly benamning: string;
    readonly anskaffningsdatum: Datum;
    readonly anskaffningsvarde: Ore;
    readonly kategori: Fastighetskategori;
  }) => Promise<string>;
  readonly onAvyttraFastighet: (
    id: Uuid,
    avyttring: {
      readonly datum: Datum;
      readonly typ: 'forsaljning' | 'utrangering';
      readonly forsaljningsinkomst: Ore;
    },
  ) => Promise<string>;
  readonly onBokforFastighetsavskrivning: (
    id: Uuid,
    belopp: Ore,
    avskrivningskostnadKonto: Kontonummer,
    ackAvskrivningKonto: Kontonummer,
  ) => Promise<string>;
}

/**
 * Anläggningsregistret: vad som ägs, och årets kollektiva avskrivning.
 *
 * Registret finns för spårbarhet och för kompletteringsregeln - potten som
 * faktiskt skrivs av är kontona själva (se src/data/anlaggning.ts), inte en
 * summa av det som råkar stå här. Att registrera en tillgång och att bokföra
 * dess inköp är därför två skilda saker användaren gör, precis som idag.
 */
export function Anlaggningssida({
  onTillbaka,
  rakenskapsar,
  anlaggningar,
  fastigheter,
  idag,
  onRegistrera,
  onAvyttra,
  onBeraknaAvskrivning,
  onBokforAvskrivning,
  onRegistreraFastighet,
  onAvyttraFastighet,
  onBokforFastighetsavskrivning,
  egnaPrisbasbelopp,
  onHamtaPrisbasbelopp,
  onSparaPrisbasbelopp,
}: Props) {
  const [benamning, setBenamning] = useState('');
  const [anskaffningsdatum, setAnskaffningsdatum] = useState(idag);
  const [belopp, setBelopp] = useState('');
  const [nyttjandeperiod, setNyttjandeperiod] = useState('5');
  const [oppen, setOppen] = useState<string | undefined>();
  const [avyttringstyp, setAvyttringstyp] = useState<'forsaljning' | 'utrangering'>(
    'forsaljning',
  );
  const [avyttringsbelopp, setAvyttringsbelopp] = useState('');
  const [avyttringsdatum, setAvyttringsdatum] = useState(idag);

  const [ar, setAr] = useState<string>(rakenskapsar[0]?.id ?? '');
  const [poolkontoText, setPoolkontoText] = useState('1220, 1221, 1222, 1229');
  const [avskrivningskostnadText, setAvskrivningskostnadText] = useState('7830');
  const [ackAvskrivningText, setAckAvskrivningText] = useState('1229');
  const [underlag, setUnderlag] = useState<Arsavskrivningsunderlag | undefined>();

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
  const nyttjandeperiodTal = Number(nyttjandeperiod);
  /*
   * The limit for the year the asset was bought, not for today: Skatteverket
   * gives it per inkomstår. Undefined when that year's prisbasbelopp is not in
   * the table, which leaves the hint quiet rather than guessing.
   */
  const halvtPrisbasbelopp = (() => {
    try {
      return halvtPrisbasbeloppFor(delar(anskaffningsdatum).ar, egnaPrisbasbelopp);
    } catch {
      return undefined;
    }
  })();
  const direktavdrag =
    halvtPrisbasbelopp !== undefined &&
    beloppOre !== undefined &&
    Number.isInteger(nyttjandeperiodTal) &&
    nyttjandeperiodTal > 0 &&
    kravsDirektavdrag(beloppOre, nyttjandeperiodTal, halvtPrisbasbelopp);

  function tolkaKonton(text: string): Kontonummer[] {
    return text
      .split(',')
      .map((del) => del.trim())
      .filter((del) => del.length > 0)
      .map((del) => kontonummer(del));
  }

  return (
    <section aria-label="Anläggningsregister">
      <Tillbaka onTillbaka={onTillbaka} />
      <h2>Anläggningsregister</h2>

      <p className="hjalptext">
        Maskiner och inventarier skrivs av kollektivt, som en klumpsumma för allt som ägs
        - inte per tillgång. Registret nedan är till för spårbarhet och för
        kompletteringsregeln, som behöver varje tillgångs eget anskaffningsvärde och
        ålder.
      </p>

      {anlaggningar.length === 0 ? (
        <p className="tomt" data-testid="inga-anlaggningar">
          Inget är registrerat ännu.
        </p>
      ) : (
        <ul className="lista" data-testid="anlaggningslista">
          {anlaggningar.map((tillgang) => {
            const visas = oppen === tillgang.id;
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
                      {tillgang.anskaffningsdatum}
                      {tillgang.avyttring !== undefined &&
                        ` · ${tillgang.avyttring.typ === 'forsaljning' ? 'Såld' : 'Utrangerad'} ${tillgang.avyttring.datum}`}
                    </span>
                  </span>
                  <span className="belopp">
                    {formatKronor(tillgang.anskaffningsvarde)}
                  </span>
                </button>

                {visas && tillgang.avyttring === undefined && (
                  <div className="kort" data-testid={`avyttra-${tillgang.id}`}>
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
                      <label htmlFor="avyttringsdatum">Datum</label>
                      <input
                        id="avyttringsdatum"
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
                        <label htmlFor="avyttringsbelopp">Försäljningsinkomst</label>
                        <input
                          id="avyttringsbelopp"
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
                      className="knapp knapp--primar"
                      disabled={arbetar}
                      data-testid={`bekrafta-avyttring-${tillgang.id}`}
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

      <h2>Ny anläggningstillgång</h2>

      <div className="faltgrupp">
        <label htmlFor="anlaggning-benamning">Tillgångens benämning</label>
        <input
          id="anlaggning-benamning"
          className="falt"
          value={benamning}
          onChange={(handelse) => setBenamning(handelse.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="anlaggning-datum">Tillgångens anskaffningsdatum</label>
        <input
          id="anlaggning-datum"
          className="falt"
          type="date"
          value={anskaffningsdatum}
          onChange={(handelse) => setAnskaffningsdatum(handelse.target.value as Datum)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="anlaggning-belopp">Tillgångens anskaffningsvärde</label>
        <input
          id="anlaggning-belopp"
          className="falt"
          inputMode="decimal"
          value={belopp}
          onChange={(handelse) => setBelopp(handelse.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="anlaggning-nyttjandeperiod">Uppskattad nyttjandeperiod, år</label>
        <input
          id="anlaggning-nyttjandeperiod"
          className="falt"
          inputMode="numeric"
          value={nyttjandeperiod}
          onChange={(handelse) => setNyttjandeperiod(handelse.target.value)}
        />
      </div>

      {direktavdrag && (
        <p role="status" data-testid="direktavdrag-varning">
          Det här får kostnadsföras direkt i stället för att registreras här - värdet är
          högst ett halvt prisbasbelopp, eller nyttjandeperioden högst tre år (BFN K1
          punkt 6.30, 6.31). Bokför det som en vanlig utgift.
        </p>
      )}

      <button
        type="button"
        className="knapp knapp--primar"
        disabled={
          arbetar ||
          benamning.trim() === '' ||
          beloppOre === undefined ||
          !Number.isInteger(nyttjandeperiodTal) ||
          nyttjandeperiodTal <= 0
        }
        data-testid="registrera-anlaggning"
        onClick={() =>
          void kor(async () => {
            const resultat = await onRegistrera({
              benamning,
              anskaffningsdatum,
              anskaffningsvarde: beloppOre!,
              nyttjandeperiod: nyttjandeperiodTal,
            });
            setBenamning('');
            setBelopp('');
            return resultat;
          })
        }
      >
        Registrera
      </button>

      <h2>Årets avskrivning</h2>

      <Prisbasbeloppssektion
        egna={egnaPrisbasbelopp}
        idag={idag}
        onHamta={onHamtaPrisbasbelopp}
        onSpara={onSparaPrisbasbelopp}
      />

      <div className="faltgrupp">
        <label htmlFor="avskrivning-ar">Räkenskapsår</label>
        <select
          id="avskrivning-ar"
          className="falt"
          value={ar}
          onChange={(handelse) => setAr(handelse.target.value)}
        >
          {rakenskapsar.map((kandidat) => (
            <option key={kandidat.id} value={kandidat.id}>
              {kandidat.start.slice(0, 4)}
            </option>
          ))}
        </select>
      </div>

      <div className="faltgrupp">
        <label htmlFor="poolkonton">Konton för potten, kommaseparerat</label>
        <input
          id="poolkonton"
          className="falt"
          value={poolkontoText}
          onChange={(handelse) => setPoolkontoText(handelse.target.value)}
        />
      </div>

      <button
        type="button"
        className="knapp"
        disabled={arbetar || ar === ''}
        data-testid="berakna-avskrivning"
        onClick={() =>
          void kor(async () => {
            const rakenskapsarId = ar as Uuid;
            const resultat = await onBeraknaAvskrivning(
              rakenskapsarId,
              tolkaKonton(poolkontoText),
            );
            setUnderlag(resultat);
            return `Underlag ${formatKronor(resultat.forslag.underlag)} kr.`;
          })
        }
      >
        Beräkna
      </button>

      {underlag !== undefined && (
        <div className="kort" data-testid="avskrivningsforslag">
          <dl>
            <dt>IB</dt>
            <dd>{formatKronor(underlag.ib)}</dd>
            <dt>Årets inköp</dt>
            <dd>{formatKronor(underlag.aretsInkop)}</dd>
            <dt>Årets avyttrat</dt>
            <dd>{formatKronor(underlag.aretsAvyttrat)}</dd>
            <dt>Avskrivningsunderlag</dt>
            <dd>{formatKronor(underlag.forslag.underlag)}</dd>
          </dl>

          <div className="faltgrupp">
            <label htmlFor="avskrivningskostnadkonto">
              Kostnadskonto för avskrivningen
            </label>
            <input
              id="avskrivningskostnadkonto"
              className="falt"
              value={avskrivningskostnadText}
              onChange={(handelse) => setAvskrivningskostnadText(handelse.target.value)}
            />
          </div>

          <div className="faltgrupp">
            <label htmlFor="ackavskrivningkonto">
              Kontot för ackumulerade avskrivningar
            </label>
            <input
              id="ackavskrivningkonto"
              className="falt"
              value={ackAvskrivningText}
              onChange={(handelse) => setAckAvskrivningText(handelse.target.value)}
            />
          </div>

          <p className="hjalptext">
            {underlag.forslag.underlag <= 0
              ? 'Underlaget är noll, så det finns inget att skriva av än - registrera och bokför en anskaffning först.'
              : 'Tre regler räknade parallellt, plus möjligheten att skriva av hela underlaget när det är litet nog - vilken som bokförs är alltid ett val, aldrig ett förslag som redan är ifyllt (hård regel 10).'}
          </p>

          <ul className="lista" data-testid="avskrivningsforslag-rader">
            {(
              [
                ['Huvudregeln, 30 %', underlag.forslag.huvudregeln, 'huvudregeln'],
                [
                  'Kompletteringsregeln',
                  underlag.forslag.kompletteringsregeln,
                  'kompletteringsregeln',
                ],
                [
                  'Restvärdesavskrivning, 25 %',
                  underlag.forslag.restvardesavskrivning,
                  'restvardesavskrivning',
                ],
                ...(underlag.forslag.helaUnderlaget === undefined
                  ? []
                  : ([
                      [
                        'Hela underlaget (under halvt prisbasbelopp)',
                        underlag.forslag.helaUnderlaget,
                        'helaUnderlaget',
                      ],
                    ] as const)),
              ] as const
            ).map(([namn, avskrivning, nyckel]) => (
              <li key={nyckel}>
                <div className="listrad">
                  <span className="listrad__text">
                    <span>{namn}</span>
                  </span>
                  <span className="belopp">{formatKronor(avskrivning)}</span>
                </div>
                <p>
                  <button
                    type="button"
                    className="knapp"
                    disabled={arbetar || avskrivning <= 0}
                    data-testid={`bokfor-${nyckel}`}
                    onClick={() =>
                      void kor(async () => {
                        const resultat = await onBokforAvskrivning(
                          ar as Uuid,
                          avskrivning,
                          kontonummer(avskrivningskostnadText),
                          kontonummer(ackAvskrivningText),
                        );
                        setUnderlag(undefined);
                        return resultat;
                      })
                    }
                  >
                    Bokför {formatKronor(avskrivning)} kr
                  </button>
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {arbetar && <p data-testid="anlaggning-arbetar">Arbetar …</p>}

      {besked !== undefined && (
        <p className="kort" role="status" data-testid="anlaggning-besked">
          {besked}
        </p>
      )}

      {fel !== undefined && (
        <p role="alert" data-testid="anlaggning-fel">
          {fel}
        </p>
      )}

      <Fastighetssektion
        fastigheter={fastigheter}
        idag={idag}
        onRegistrera={onRegistreraFastighet}
        onAvyttra={onAvyttraFastighet}
        onBokforAvskrivning={onBokforFastighetsavskrivning}
      />
    </section>
  );
}
