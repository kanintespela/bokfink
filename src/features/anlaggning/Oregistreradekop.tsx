import { useState } from 'react';

import type {
  Anlaggningskop,
  Anlaggningsslag,
} from '../../domain/anlaggning/anlaggningskop';
import {
  BYGGNADSTYP_NAMN,
  MARKANLAGGNINGSTYP_NAMN,
  type Byggnadstyp,
  type Markanlaggningstyp,
} from '../../domain/anlaggning/byggnadsprocentsatser';
import type { Fastighetskategori } from '../../domain/anlaggning/fastighetstillgang';
import {
  formatKronor,
  kronorString,
  oreFromKronor,
  type Ore,
} from '../../domain/belopp/ore';
import type { Uuid } from '../../domain/id/uuidv7';
import type { Datum } from '../../domain/tid/datum';
import { beteckning } from '../../domain/verifikat/verifikat';
import { Uppgiftsstatus, useUppgift } from '../data/uppgift';

export const SLAGNAMN: Record<Anlaggningsslag, string> = {
  inventarie: 'Maskin eller inventarie',
  byggnad: 'Byggnad',
  markanlaggning: 'Markanläggning',
  mark: 'Mark',
};

/** " · Köpt med A14", for a register entry that knows its verifikat. */
export function kopt(
  verifikatId: Uuid | undefined,
  verifikatnamn: ReadonlyMap<Uuid, string>,
): string {
  const namn = verifikatId === undefined ? undefined : verifikatnamn.get(verifikatId);
  return namn === undefined ? '' : ` · Köpt med ${namn}`;
}

interface Props {
  readonly kop: readonly Anlaggningskop[];
  /** The purchase to open the form for straight away, when the screen was reached from one. */
  readonly oppnaFor?: Uuid | undefined;
  readonly onRegistrera: (uppgifter: {
    readonly benamning: string;
    readonly anskaffningsdatum: Datum;
    readonly anskaffningsvarde: Ore;
    readonly nyttjandeperiod: number;
    readonly verifikatId: Uuid;
  }) => Promise<string>;
  readonly onRegistreraFastighet: (uppgifter: {
    readonly benamning: string;
    readonly anskaffningsdatum: Datum;
    readonly anskaffningsvarde: Ore;
    readonly kategori: Fastighetskategori;
    readonly verifikatId: Uuid;
  }) => Promise<string>;
  readonly onInteAnlaggning: (verifikatId: Uuid) => Promise<void>;
}

/**
 * Purchases booked on asset accounts that the register does not hold yet.
 *
 * A suggestion, and the user's to act on (hard rule 10). The form is filled
 * in from the verifikat - what it was called, when, and what it cost without
 * moms - so that nothing is typed twice, and everything in it can be changed
 * before it is saved. Nothing is registered until the button is pressed, and
 * "Inte en anläggning" ends the question for a verifikat that only looked
 * like one.
 */
export function Oregistreradekop({
  kop,
  oppnaFor,
  onRegistrera,
  onRegistreraFastighet,
  onInteAnlaggning,
}: Props) {
  const [oppen, setOppen] = useState<Uuid | undefined>(oppnaFor);
  const { arbetar, besked, fel, kor } = useUppgift();

  if (kop.length === 0 && besked === undefined && fel === undefined) {
    return null;
  }

  return (
    <section aria-label="Köp som inte finns i registret" data-testid="oregistrerade-kop">
      {kop.length > 0 && (
        <>
          <h2>Köp som inte finns i registret</h2>
          <p className="hjalptext">
            De här köpen är bokförda som anläggningstillgångar i år, men finns inte i
            registret. Det är registret som avskrivningarna räknas på.
          </p>
          <ul className="lista">
            {kop.map((post) => (
              <li key={post.verifikat.id}>
                <div className="listrad">
                  <span className="listrad__text">
                    <strong>{post.verifikat.beskrivning}</strong>
                    <span className="listrad__sekundar">
                      {beteckning(post.verifikat)} · {post.verifikat.datum} ·{' '}
                      {SLAGNAMN[post.slag]}
                    </span>
                  </span>
                  <span className="belopp">{formatKronor(post.belopp)}</span>
                </div>
                {oppen === post.verifikat.id ? (
                  <Kopformular
                    kop={post}
                    arbetar={arbetar}
                    onAvbryt={() => setOppen(undefined)}
                    onSpara={(spara) =>
                      void kor(async () => {
                        const svar = await spara();
                        setOppen(undefined);
                        return svar;
                      })
                    }
                    onRegistrera={onRegistrera}
                    onRegistreraFastighet={onRegistreraFastighet}
                  />
                ) : (
                  <p className="listrad__formular">
                    <button
                      type="button"
                      className="knapp knapp--primar"
                      disabled={arbetar}
                      aria-label={`Lägg in ${post.verifikat.beskrivning} i registret`}
                      onClick={() => setOppen(post.verifikat.id)}
                    >
                      Lägg in i registret
                    </button>{' '}
                    <button
                      type="button"
                      className="knapp knapp--text"
                      disabled={arbetar}
                      aria-label={`${post.verifikat.beskrivning} är inte en anläggning`}
                      onClick={() =>
                        void kor(async () => {
                          await onInteAnlaggning(post.verifikat.id);
                          return `${post.verifikat.beskrivning} föreslås inte igen.`;
                        })
                      }
                    >
                      Inte en anläggning
                    </button>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      <Uppgiftsstatus arbetar={arbetar} besked={besked} fel={fel} />
    </section>
  );
}

function Kopformular({
  kop,
  arbetar,
  onAvbryt,
  onSpara,
  onRegistrera,
  onRegistreraFastighet,
}: {
  readonly kop: Anlaggningskop;
  readonly arbetar: boolean;
  readonly onAvbryt: () => void;
  readonly onSpara: (spara: () => Promise<string>) => void;
} & Pick<Props, 'onRegistrera' | 'onRegistreraFastighet'>) {
  const id = kop.verifikat.id;
  const [benamning, setBenamning] = useState(kop.verifikat.beskrivning);
  const [datum, setDatum] = useState<Datum>(kop.verifikat.datum);
  const [belopp, setBelopp] = useState(
    // With a comma, as amounts are typed everywhere else in the app.
    kronorString(kop.belopp).replace('.', ','),
  );
  const [slag, setSlag] = useState<Anlaggningsslag>(kop.slag);
  const [nyttjandeperiod, setNyttjandeperiod] = useState('5');
  const [byggnadstyp, setByggnadstyp] = useState<Byggnadstyp>('ekonomibyggnad_ovrig');
  const [markanlaggningstyp, setMarkanlaggningstyp] =
    useState<Markanlaggningstyp>('ovrig');

  return (
    <form
      className="faltgrupp listrad__formular"
      data-testid={`kopformular-${id}`}
      onSubmit={(handelse) => {
        handelse.preventDefault();
        onSpara(() => {
          const gemensamt = {
            benamning,
            anskaffningsdatum: datum,
            anskaffningsvarde: oreFromKronor(belopp),
            verifikatId: id,
          };
          if (slag === 'inventarie') {
            return onRegistrera({
              ...gemensamt,
              nyttjandeperiod: Number(nyttjandeperiod),
            });
          }
          const kategori: Fastighetskategori =
            slag === 'byggnad'
              ? { typ: 'byggnad', byggnadstyp }
              : slag === 'markanlaggning'
                ? { typ: 'markanlaggning', markanlaggningstyp }
                : { typ: 'mark' };
          return onRegistreraFastighet({ ...gemensamt, kategori });
        });
      }}
    >
      <label htmlFor={`kop-benamning-${id}`}>Benämning</label>
      <input
        id={`kop-benamning-${id}`}
        className="falt"
        value={benamning}
        onChange={(handelse) => setBenamning(handelse.target.value)}
      />

      <label htmlFor={`kop-datum-${id}`}>Anskaffningsdatum</label>
      <input
        id={`kop-datum-${id}`}
        className="falt"
        type="date"
        value={datum}
        onChange={(handelse) => setDatum(handelse.target.value as Datum)}
      />

      <label htmlFor={`kop-belopp-${id}`}>Anskaffningsvärde, utan moms</label>
      <input
        id={`kop-belopp-${id}`}
        className="falt"
        inputMode="decimal"
        value={belopp}
        onChange={(handelse) => setBelopp(handelse.target.value)}
      />

      <label htmlFor={`kop-slag-${id}`}>Vad är det?</label>
      <select
        id={`kop-slag-${id}`}
        className="falt"
        value={slag}
        onChange={(handelse) => setSlag(handelse.target.value as Anlaggningsslag)}
      >
        {(Object.keys(SLAGNAMN) as Anlaggningsslag[]).map((val) => (
          <option key={val} value={val}>
            {SLAGNAMN[val]}
          </option>
        ))}
      </select>
      {slag !== kop.slag && (
        <p className="hjalptext">
          Köpet är bokfört som {SLAGNAMN[kop.slag].toLocaleLowerCase('sv')}. Registret
          ändrar inte bokföringen: är kontot fel rättas det med ett nytt verifikat.
        </p>
      )}

      {slag === 'inventarie' && (
        <>
          <label htmlFor={`kop-period-${id}`}>Nyttjandeperiod, år</label>
          <input
            id={`kop-period-${id}`}
            className="falt"
            inputMode="numeric"
            value={nyttjandeperiod}
            onChange={(handelse) => setNyttjandeperiod(handelse.target.value)}
          />
        </>
      )}
      {slag === 'byggnad' && (
        <>
          <label htmlFor={`kop-byggnadstyp-${id}`}>Byggnadstyp</label>
          <select
            id={`kop-byggnadstyp-${id}`}
            className="falt"
            value={byggnadstyp}
            onChange={(handelse) => setByggnadstyp(handelse.target.value as Byggnadstyp)}
          >
            {(Object.keys(BYGGNADSTYP_NAMN) as Byggnadstyp[]).map((typ) => (
              <option key={typ} value={typ}>
                {BYGGNADSTYP_NAMN[typ]}
              </option>
            ))}
          </select>
        </>
      )}
      {slag === 'markanlaggning' && (
        <>
          <label htmlFor={`kop-markanlaggningstyp-${id}`}>Markanläggningstyp</label>
          <select
            id={`kop-markanlaggningstyp-${id}`}
            className="falt"
            value={markanlaggningstyp}
            onChange={(handelse) =>
              setMarkanlaggningstyp(handelse.target.value as Markanlaggningstyp)
            }
          >
            {(Object.keys(MARKANLAGGNINGSTYP_NAMN) as Markanlaggningstyp[]).map((typ) => (
              <option key={typ} value={typ}>
                {MARKANLAGGNINGSTYP_NAMN[typ]}
              </option>
            ))}
          </select>
        </>
      )}

      <button type="submit" className="knapp knapp--primar" disabled={arbetar}>
        Spara i registret
      </button>
      <button type="button" className="knapp knapp--text" onClick={onAvbryt}>
        Avbryt
      </button>
    </form>
  );
}
