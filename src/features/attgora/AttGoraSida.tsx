import { useState } from 'react';

import { formatKronor } from '../../domain/belopp/ore';
import type { VantandeMomsdeklaration } from '../../domain/moms/deklarationsdag';
import type { VantandeFaktura } from '../../domain/underlag/forfallodag';
import { tolkaKvitto } from '../../domain/underlag/kvittotolkning';
import type { Datum } from '../../domain/tid/datum';
import { beteckning, omslutning } from '../../domain/verifikat/verifikat';
import type { Verifikatpost } from '../../data/bokforing';

/**
 * How many days a backup may age before the warning shows.
 *
 * Not a legal rule, just a UX judgement call: the backup is manual (Etapp 5
 * has not built an automatic one yet), so the warning has to fire before the
 * gap gets so wide that a lost device would cost real bookkeeping, without
 * nagging after every single day that passes.
 */
const GAMMAL_BACKUP_GRANS = 30;

interface Props {
  readonly idag: Datum;
  /** The one booked last, by when it was booked rather than its number. */
  readonly senaste: Verifikatpost | undefined;
  readonly utkast: number;
  /** Receipts photographed but not booked yet. */
  readonly kvitton: number;
  /** Undefined when no backup has ever been taken on this device. */
  readonly dagarSedanBackup: number | undefined;
  /** Ended quarters not yet locked as declared, oldest first. */
  readonly momsdeklarationer: readonly VantandeMomsdeklaration[];
  /** Waiting invoices with a due date, the one due first at the top. */
  readonly fakturor: readonly VantandeFaktura[];
  /**
   * Saves or shares a backup and records it - right where the warning is.
   * Encrypted with a passphrase, or in plain text without one: the owner
   * decides where the copy goes, and so whether it needs a lock.
   */
  readonly onSnabbBackup: (losenfras?: string) => Promise<string>;
  readonly onMoms: () => void;
  readonly onKvitton: () => void;
  readonly onUtkast: () => void;
  readonly onVisaVerifikat: () => void;
}

/**
 * The start view: what needs doing, and nothing else to choose between.
 *
 * Deliberately not the entry form. Opening straight into a list of templates
 * assumes the answer is always "book something", and most times the app is
 * opened the question is really "is there anything I have missed?". Booking
 * is a tab away. The registers, the year-end and the settings used to be
 * listed here too, under the to-do list; they live under Mer now, so this
 * view stays short enough to answer its question at a glance.
 */
export function AttGoraSida({
  idag,
  senaste,
  utkast,
  kvitton,
  dagarSedanBackup,
  momsdeklarationer,
  fakturor,
  onSnabbBackup,
  onMoms,
  onKvitton,
  onUtkast,
  onVisaVerifikat,
}: Props) {
  const backupGammal =
    dagarSedanBackup === undefined || dagarSedanBackup > GAMMAL_BACKUP_GRANS;

  const [backupLosenfras, setBackupLosenfras] = useState('');
  const [backupArbetar, setBackupArbetar] = useState(false);
  const [backupBesked, setBackupBesked] = useState<string | undefined>();
  const [backupFel, setBackupFel] = useState<string | undefined>();

  async function taSnabbBackup(krypterad: boolean) {
    setBackupArbetar(true);
    setBackupBesked(undefined);
    setBackupFel(undefined);
    try {
      setBackupBesked(await onSnabbBackup(krypterad ? backupLosenfras : undefined));
      setBackupLosenfras('');
    } catch (orsak) {
      // Hard rule 11: shown, not swallowed.
      setBackupFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setBackupArbetar(false);
    }
  }

  return (
    <section aria-label="Att göra">
      <p>{idag}</p>

      <h2>Att göra</h2>

      {utkast > 0 && (
        <button
          type="button"
          className="kort listrad"
          data-testid="utkast-vantar"
          onClick={onUtkast}
        >
          <span className="listrad__text">
            <strong>
              {utkast === 1 ? 'Ett utkast' : `${utkast} utkast`} väntar på att bokföras.
            </strong>
          </span>
        </button>
      )}

      {kvitton > 0 && (
        <button
          type="button"
          className="kort listrad"
          data-testid="kvitton-vantar"
          onClick={onKvitton}
        >
          <span className="listrad__text">
            <strong>
              {kvitton === 1 ? 'Ett kvitto' : `${kvitton} kvitton`} väntar på att
              bokföras.
            </strong>
          </span>
        </button>
      )}

      {/*
       * Stays mounted through a successful save even after backupGammal has
       * flipped to false, so the confirmation has somewhere to appear - a
       * card that vanished the instant the backup succeeded would hide the
       * one message that proves the tap worked.
       */}
      {momsdeklarationer[0] !== undefined && (
        <Momskort vantande={momsdeklarationer} onMoms={onMoms} />
      )}

      {fakturor[0] !== undefined && (
        <Fakturakort idag={idag} vantande={fakturor} onKvitton={onKvitton} />
      )}

      {(backupGammal || backupBesked !== undefined) && (
        <div className="kort" data-testid="backup-gammal">
          {backupBesked === undefined ? (
            <>
              <strong>
                {dagarSedanBackup === undefined
                  ? 'Ingen säkerhetskopia är tagen än.'
                  : `Senaste säkerhetskopian är ${dagarSedanBackup} dagar gammal.`}
              </strong>

              <div className="faltgrupp">
                <label htmlFor="attgora-backup-losenfras">
                  Lösenfras för säkerhetskopian
                </label>
                <input
                  id="attgora-backup-losenfras"
                  className="falt"
                  type="password"
                  autoComplete="off"
                  value={backupLosenfras}
                  onChange={(handelse) => setBackupLosenfras(handelse.target.value)}
                />
              </div>

              <p>
                <button
                  type="button"
                  className="knapp"
                  disabled={backupArbetar || backupLosenfras.trim().length === 0}
                  data-testid="snabb-backup"
                  onClick={() => void taSnabbBackup(true)}
                >
                  Säkerhetskopiera nu
                </button>
              </p>

              <p className="hjalptext">
                Utan lösenfras är hela bokföringen och alla kvittobilder läsbara för den
                som kommer åt filen.
              </p>

              <p>
                <button
                  type="button"
                  className="knapp knapp--text"
                  disabled={backupArbetar}
                  data-testid="snabb-backup-oskyddad"
                  onClick={() => void taSnabbBackup(false)}
                >
                  Spara oskyddad kopia
                </button>
              </p>
            </>
          ) : (
            <p
              className="listrad__sekundar"
              role="status"
              data-testid="snabb-backup-besked"
            >
              {backupBesked}
            </p>
          )}

          {backupFel !== undefined && (
            <p role="alert" data-testid="snabb-backup-fel">
              {backupFel}
            </p>
          )}
        </div>
      )}

      {utkast === 0 &&
        kvitton === 0 &&
        momsdeklarationer.length === 0 &&
        !backupGammal && (
          <p className="tomt" data-testid="inget-att-gora">
            Ingenting väntar just nu.
          </p>
        )}

      <h2>Senast bokfört</h2>

      {senaste === undefined ? (
        <p className="tomt" data-testid="inget-bokfort">
          Inget är bokfört i det här räkenskapsåret ännu.
        </p>
      ) : (
        <button
          type="button"
          className="kort listrad"
          data-testid="senaste-verifikat"
          onClick={onVisaVerifikat}
        >
          <span className="listrad__text">
            <span>{beteckning(senaste.verifikat)}</span>
            <span className="listrad__sekundar">
              {senaste.verifikat.datum}
              {senaste.verifikat.beskrivning.length > 0 &&
                ` · ${senaste.verifikat.beskrivning}`}
            </span>
          </span>
          <span className="belopp">{formatKronor(omslutning(senaste.verifikat))}</span>
        </button>
      )}
    </section>
  );
}

/**
 * The oldest undeclared quarter, with the rest counted rather than listed.
 *
 * Locking the period on the Moms page is what clears it, so the card says
 * that: without it, a deklaration already filed elsewhere would keep the
 * reminder up with no hint of how to make it go away.
 */
function Momskort({
  vantande,
  onMoms,
}: {
  readonly vantande: readonly VantandeMomsdeklaration[];
  readonly onMoms: () => void;
}) {
  const [forsta, ...ovriga] = vantande;
  if (forsta === undefined) {
    return null;
  }
  const { period, sistaDag, dagarKvar } = forsta;

  return (
    <button
      type="button"
      className="kort listrad"
      data-testid="momsdeklaration-vantar"
      onClick={onMoms}
    >
      <span className="listrad__text">
        <strong>
          {dagarKvar < 0 ? (
            <>
              Momsen för {period.namn} skulle ha deklarerats och betalats senast{' '}
              <span style={{ whiteSpace: 'nowrap' }}>{sistaDag}</span>.
            </>
          ) : dagarKvar === 0 ? (
            <>Momsen för {period.namn} ska deklareras och betalas i dag.</>
          ) : (
            <>
              Momsen för {period.namn} ska deklareras och betalas senast{' '}
              <span style={{ whiteSpace: 'nowrap' }}>{sistaDag}</span>, om{' '}
              {dagarKvar === 1 ? 'en dag' : `${dagarKvar} dagar`}.
            </>
          )}
        </strong>
        <span className="hjalptext">
          {ovriga.length > 0 &&
            `${ovriga.length === 1 ? 'En period till' : `${ovriga.length} perioder till`} väntar. `}
          När deklarationen är inlämnad: lås perioden på Moms-sidan, så försvinner
          påminnelsen.
        </span>
      </span>
    </button>
  );
}

/**
 * The invoice due first, named by its supplier when the text says who.
 *
 * Paying it and booking the payment links the underlag, which is what takes
 * the card away - so the card points to the receipts, where that starts.
 */
function Fakturakort({
  idag,
  vantande,
  onKvitton,
}: {
  readonly idag: Datum;
  readonly vantande: readonly VantandeFaktura[];
  readonly onKvitton: () => void;
}) {
  const [forsta, ...ovriga] = vantande;
  if (forsta === undefined) {
    return null;
  }
  const { underlag, forfallodag, dagarKvar } = forsta;
  const leverantor =
    underlag.text === undefined ? undefined : tolkaKvitto(underlag.text, idag).leverantor;
  const vilken = leverantor === undefined ? 'En faktura' : `Fakturan från ${leverantor}`;

  return (
    <button
      type="button"
      className="kort listrad"
      data-testid="faktura-forfaller"
      onClick={onKvitton}
    >
      <span className="listrad__text">
        <strong>
          {dagarKvar < 0 ? (
            <>
              {vilken} skulle ha betalats senast{' '}
              <span style={{ whiteSpace: 'nowrap' }}>{forfallodag}</span>.
            </>
          ) : dagarKvar === 0 ? (
            <>{vilken} ska betalas i dag.</>
          ) : (
            <>
              {vilken} ska betalas senast{' '}
              <span style={{ whiteSpace: 'nowrap' }}>{forfallodag}</span>, om{' '}
              {dagarKvar === 1 ? 'en dag' : `${dagarKvar} dagar`}.
            </>
          )}
        </strong>
        <span className="hjalptext">
          {ovriga.length > 0 &&
            `${ovriga.length === 1 ? 'En faktura till' : `${ovriga.length} fakturor till`} väntar. `}
          När den är betald: bokför den, så försvinner påminnelsen.
        </span>
      </span>
    </button>
  );
}
