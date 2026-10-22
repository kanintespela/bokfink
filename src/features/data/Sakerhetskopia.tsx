import { useRef, useState } from 'react';

import { delaEllerSpara } from '../../platform/fil';
import { Uppgiftsstatus, useUppgift } from './uppgift';
import { useFilprefix } from '../../ui/bok';

interface Props {
  /**
   * The backup itself. A passphrase means an encrypted file; without one the
   * bookkeeping is written in plain text.
   */
  readonly onSakerhetskopia: (losenfras?: string) => Promise<string>;
  /** Records when a backup was last produced, for the old-backup warning. */
  readonly onBackupTagen: () => Promise<void>;
  readonly onAterstall: (text: string, losenfras?: string) => Promise<string>;
  /** True when the picked file is encrypted and needs a passphrase. */
  readonly onArKrypterad: (text: string) => boolean;
}

/**
 * The copy that must never be forgotten.
 *
 * Its own screen rather than a paragraph among the exports: the plan calls
 * the backup part of the product rather than an extra, and a passphrase
 * field sitting between two unrelated buttons is how it starts being treated
 * as one.
 */
export function Sakerhetskopia({
  onSakerhetskopia,
  onBackupTagen,
  onAterstall,
  onArKrypterad,
}: Props) {
  const filprefix = useFilprefix();
  const kopievaljare = useRef<HTMLInputElement>(null);
  /*
   * The passphrase is held only while the screen is open, and never stored.
   * There is nowhere to store it that would not defeat the point of it.
   */
  const [losenfras, setLosenfras] = useState('');
  /** A picked file that turned out to be encrypted, waiting for a passphrase. */
  const [laste, setLaste] = useState<string | undefined>();
  const { arbetar, besked, fel, kor } = useUppgift();

  return (
    <section aria-label="Säkerhetskopia">
      <h2>Säkerhetskopia</h2>

      {/*
       * The passphrase belongs to the backup, not to the app: it is asked for
       * here, used, and forgotten. Kontera has nowhere to keep it that would
       * not defeat the point of having one.
       */}
      <div className="faltgrupp">
        <label htmlFor="losenfras">Lösenfras för säkerhetskopian</label>
        <input
          id="losenfras"
          className="falt"
          type="password"
          autoComplete="off"
          value={losenfras}
          onChange={(handelse) => setLosenfras(handelse.target.value)}
        />
        <p className="hjalptext">
          En kopia med lösenfras går att lägga i molnet. Utan lösenfras är hela
          bokföringen och alla kvittobilder läsbara för den som kommer åt filen.{' '}
          <strong>Tappar du lösenfrasen finns ingen väg tillbaka.</strong>
        </p>
      </div>

      <p>
        <button
          type="button"
          className="knapp knapp--primar"
          disabled={arbetar || losenfras.trim().length === 0}
          data-testid="spara-krypterad"
          onClick={() =>
            void kor(async () => {
              const text = await onSakerhetskopia(losenfras);
              const namn = `${filprefix}-sakerhetskopia-${new Date()
                .toISOString()
                .slice(0, 10)}.json`;
              const utfall = await delaEllerSpara(namn, text, 'application/json');
              await onBackupTagen();
              return utfall === 'delad'
                ? 'Den krypterade säkerhetskopian delades.'
                : `Den krypterade säkerhetskopian sparades som ${namn}.`;
            })
          }
        >
          Spara krypterad säkerhetskopia
        </button>
      </p>

      <p>
        <button
          type="button"
          className="knapp knapp--text"
          disabled={arbetar}
          data-testid="spara-oskyddad"
          onClick={() =>
            void kor(async () => {
              const text = await onSakerhetskopia();
              const namn = `${filprefix}-oskyddad-kopia-${new Date()
                .toISOString()
                .slice(0, 10)}.json`;
              const utfall = await delaEllerSpara(namn, text, 'application/json');
              await onBackupTagen();
              return utfall === 'delad'
                ? 'Den oskyddade kopian delades.'
                : `Den oskyddade kopian sparades som ${namn}.`;
            })
          }
        >
          Spara oskyddad kopia
        </button>
      </p>

      <input
        ref={kopievaljare}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="kopiefil"
        onChange={(handelse) => {
          const vald = handelse.target.files?.[0];
          void kor(async () => {
            if (vald === undefined) {
              return 'Ingen fil valdes.';
            }
            const text = await vald.text();
            if (kopievaljare.current !== null) {
              kopievaljare.current.value = '';
            }

            /*
             * An encrypted file is recognised rather than announced: the
             * person choosing a file should not have to remember which of the
             * two kinds it was.
             */
            if (onArKrypterad(text) && losenfras.trim().length === 0) {
              setLaste(text);
              return 'Kopian är krypterad. Skriv lösenfrasen och tryck Lås upp.';
            }

            return onAterstall(text, losenfras.trim().length > 0 ? losenfras : undefined);
          });
        }}
      />

      <p>
        <button
          type="button"
          className="knapp"
          disabled={arbetar}
          data-testid="aterstall"
          onClick={() => kopievaljare.current?.click()}
        >
          Läs in säkerhetskopia
        </button>
      </p>

      {laste !== undefined && (
        <p>
          <button
            type="button"
            className="knapp knapp--primar"
            disabled={arbetar || losenfras.trim().length === 0}
            data-testid="las-upp"
            onClick={() =>
              void kor(async () => {
                const resultat = await onAterstall(laste, losenfras);
                setLaste(undefined);
                return resultat;
              })
            }
          >
            Lås upp och läs in
          </button>
        </p>
      )}

      <p>
        Att läsa in en kopia lägger till det som saknas. Ingenting som redan finns skrivs
        över, så en kopia kan läsas in i en tom app eller i en som redan har bokföring.
      </p>

      <Uppgiftsstatus arbetar={arbetar} besked={besked} fel={fel} />
    </section>
  );
}
