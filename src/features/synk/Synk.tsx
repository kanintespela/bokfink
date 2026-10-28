import { useState } from 'react';

import { foreslagenServer } from './serveradress';

interface Props {
  readonly url: string;
  readonly epost: string;
  readonly inloggad: boolean;
  readonly osankta: number;
  /**
   * What the last automatic round said when it failed.
   *
   * Shown as a line rather than an alert: a phone that lost signal mid-round
   * is not something to dismiss, and the next round tries again. But it is
   * shown (hard rule 11) - a sync that has been failing for a week is exactly
   * what silence would hide.
   */
  readonly autosynkfel: string | undefined;
  readonly senast: string | undefined;
  readonly enhet: string;
  readonly harLosenfras: boolean;
  readonly onLoggaIn: (url: string, epost: string, losenord: string) => Promise<string>;
  readonly onLoggaUt: () => Promise<void>;
  readonly onSynka: () => Promise<string>;
  readonly onLosenfras: (losenfras: string) => Promise<void>;
}

/**
 * Synchronisation, as a setting rather than a feature.
 *
 * There is nothing to operate here once it is set up: entries go out when
 * there is a connection and come in when there is something to take. The
 * screen exists to say what state it is in - how much is waiting, when it
 * last succeeded - and to give the button that forces a round when someone
 * wants to watch it happen.
 */
export function Synk({
  autosynkfel,
  url,
  epost,
  inloggad,
  osankta,
  senast,
  enhet,
  harLosenfras,
  onLoggaIn,
  onLoggaUt,
  onSynka,
  onLosenfras,
}: Props) {
  const [adress, setAdress] = useState(
    () => url || foreslagenServer(globalThis.location ?? { protocol: '', hostname: '' }),
  );
  const [minEpost, setMinEpost] = useState(epost);
  const [losenord, setLosenord] = useState('');
  const [losenfras, setLosenfras] = useState('');
  /*
   * Trimmed once, here, so the check that enables the button and the value
   * that gets saved can never drift apart. harledNyckel only normalises
   * Unicode form - it does not trim - so a phrase saved with a stray
   * trailing space derives a different key from the same words without one.
   * A masked field never shows the difference, and two devices that each
   * typed "the same phrase" would agree on everything except the one
   * character neither could see, and fail to read anything the other sent.
   */
  const rensad = losenfras.trim();
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
      // Hard rule 11: a sync that failed says why, and stays failed.
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setArbetar(false);
    }
  }

  return (
    <section aria-label="Synkronisering">
      <h2>Synk mellan enheter</h2>

      <p className="tomt">
        Enheterna byter krypterade händelser genom en egen server. Servern kan aldrig läsa
        bokföringen — den lagrar kuvert och lämnar tillbaka dem i ankomstordning.
      </p>

      <dl>
        <dt>Den här enheten</dt>
        <dd data-testid="synk-enhet">{enhet}</dd>
        <dt>Väntar på att skickas</dt>
        <dd data-testid="synk-osankta">
          {osankta === 0 ? 'Ingenting' : `${osankta} händelser`}
        </dd>
        <dt>Senast synkad</dt>
        <dd data-testid="synk-senast">{senast ?? 'Aldrig'}</dd>
      </dl>

      {inloggad ? (
        <>
          <p>
            Inloggad som {epost} mot {url}.
          </p>

          <p>
            <button
              type="button"
              className="knapp knapp--primar"
              disabled={arbetar || !harLosenfras}
              data-testid="synka-nu"
              onClick={() => void kor(onSynka)}
            >
              Synka nu
            </button>
          </p>

          <p>
            <button
              type="button"
              className="knapp knapp--text"
              disabled={arbetar}
              data-testid="logga-ut"
              onClick={() =>
                void kor(async () => {
                  await onLoggaUt();
                  return 'Utloggad. Bokföringen på enheten är orörd.';
                })
              }
            >
              Logga ut från servern
            </button>
          </p>
        </>
      ) : (
        <div className="faltgrupp">
          <label htmlFor="synkurl">Serverns adress</label>
          <input
            id="synkurl"
            className="falt"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://…ts.net:8444"
            value={adress}
            onChange={(handelse) => setAdress(handelse.target.value)}
          />

          <label htmlFor="synkepost">E-post</label>
          <input
            id="synkepost"
            className="falt"
            type="email"
            autoComplete="username"
            value={minEpost}
            onChange={(handelse) => setMinEpost(handelse.target.value)}
          />

          <label htmlFor="synklosenord">Lösenord</label>
          <input
            id="synklosenord"
            className="falt"
            type="password"
            autoComplete="current-password"
            value={losenord}
            onChange={(handelse) => setLosenord(handelse.target.value)}
          />

          <p>
            <button
              type="button"
              className="knapp"
              disabled={arbetar || adress.trim() === '' || minEpost.trim() === ''}
              data-testid="logga-in"
              onClick={() =>
                void kor(async () => {
                  const svar = await onLoggaIn(adress.trim(), minEpost.trim(), losenord);
                  setLosenord('');
                  return svar;
                })
              }
            >
              Logga in
            </button>
          </p>
        </div>
      )}

      <div className="faltgrupp">
        <label htmlFor="synklosenfras">Lösenfras för synken</label>
        <input
          id="synklosenfras"
          className="falt"
          type="password"
          autoComplete="off"
          value={losenfras}
          onChange={(handelse) => setLosenfras(handelse.target.value)}
        />
        <p className="hjalptext">
          {harLosenfras
            ? 'En lösenfras är satt på den här enheten. Skriv samma på den andra.'
            : 'Samma lösenfras måste anges på båda enheterna. Den är nyckeln servern ' +
              'aldrig får — utan den är det som ligger där obrukbart, också för dig.'}
        </p>
        <p>
          <button
            type="button"
            className="knapp"
            disabled={arbetar || rensad.length === 0}
            data-testid="spara-synklosenfras"
            onClick={() =>
              void kor(async () => {
                await onLosenfras(rensad);
                setLosenfras('');
                return 'Lösenfrasen sparades på den här enheten.';
              })
            }
          >
            Spara lösenfras
          </button>
        </p>
      </div>

      {autosynkfel !== undefined && (
        <p className="hjalptext" data-testid="autosynk-fel">
          Den automatiska synken misslyckades senast: {autosynkfel}
        </p>
      )}

      {besked !== undefined && <p data-testid="synk-besked">{besked}</p>}
      {fel !== undefined && (
        <p role="alert" data-testid="synk-fel">
          {fel}
        </p>
      )}
    </section>
  );
}
