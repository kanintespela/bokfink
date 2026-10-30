import { useMemo, useState } from 'react';

import { formatKronor, negate } from '../../domain/belopp/ore';
import type { Konto, Kontonummer } from '../../domain/konto/konto';
import type { Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import type { Datum } from '../../domain/tid/datum';
import {
  kostnadsfordelning,
  likvidaMedel,
  likviditetPerManad,
  momsskuld,
  resultatPerManad,
} from '../../domain/rapport/nyckeltal';
import { aretsResultat } from '../../domain/rapport/resultatrakning';
import { beraknaSaldon } from '../../domain/rapport/saldon';
import type { BokfortVerifikat } from '../../domain/verifikat/verifikat';
import { Andelsstaplar, Manadslinje, Manadsstaplar } from './Diagram';

interface Props {
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly verifikat: readonly BokfortVerifikat[];
  readonly rakenskapsar: readonly Rakenskapsar[];
  readonly idag: Datum;
  /** False for a book with no moms, which owes none and so shows no figure. */
  readonly visaMoms?: boolean;
}

/**
 * The four questions a one-person firm asks about its year.
 *
 * Am I making anything, is there money in the account, what does it go to,
 * and what do I owe Skatteverket. Four figures and three pictures, in that
 * order, because the figure is what is looked at and the picture is what
 * explains it.
 */
export function Nyckeltal({
  konton,
  verifikat,
  rakenskapsar,
  idag,
  visaMoms = true,
}: Props) {
  const ar = useMemo(
    () => [...rakenskapsar].sort((a, b) => b.start.localeCompare(a.start)),
    [rakenskapsar],
  );
  const [valtAr, setValtAr] = useState(() => ar[0]?.id);
  const aret = ar.find((kandidat) => kandidat.id === valtAr) ?? ar[0];

  const tal = useMemo(() => {
    if (aret === undefined) {
      return undefined;
    }
    const iAret = verifikat.filter(
      (post) => post.datum >= aret.start && post.datum <= aret.slut,
    );
    const saldon = beraknaSaldon(aret.ingaendeBalanser, iAret);

    return {
      resultat: aretsResultat(saldon),
      likvida: likvidaMedel(saldon),
      moms: momsskuld(saldon),
      perManad: resultatPerManad(aret, iAret),
      likviditet: likviditetPerManad(aret, iAret),
      kostnader: kostnadsfordelning(saldon, konton),
    };
  }, [aret, konton, verifikat]);

  if (aret === undefined || tal === undefined) {
    return (
      <p className="tomt" data-testid="inga-nyckeltal">
        Lägg upp ett räkenskapsår först.
      </p>
    );
  }

  return (
    <>
      <div className="faltgrupp">
        <label htmlFor="nyckeltalsar">Räkenskapsår</label>
        <select
          id="nyckeltalsar"
          className="falt"
          value={aret.id}
          onChange={(handelse) => setValtAr(handelse.target.value as typeof aret.id)}
        >
          {ar.map((kandidat) => (
            <option key={kandidat.id} value={kandidat.id}>
              {kandidat.start.slice(0, 4)}
            </option>
          ))}
        </select>
      </div>

      <dl className="nyckeltal" data-testid="nyckeltal">
        <dt>Resultat i år</dt>
        <dd className={tal.resultat < 0 ? 'belopp--negativ' : ''}>
          {formatKronor(tal.resultat)}
        </dd>

        <dt>Pengar i kassa och bank</dt>
        <dd className={tal.likvida < 0 ? 'belopp--negativ' : ''}>
          {formatKronor(tal.likvida)}
        </dd>

        {visaMoms && (
          <>
            <dt>{tal.moms < 0 ? 'Moms att få tillbaka' : 'Moms att betala'}</dt>
            {/* Shown as the amount it is, with the direction in the heading. */}
            <dd>{formatKronor(tal.moms < 0 ? negate(tal.moms) : tal.moms)}</dd>
          </>
        )}
      </dl>

      <h3>Resultat per månad</h3>
      <Manadsstaplar varden={tal.perManad} idag={idag} etikett="Resultat per månad" />

      <h3>Pengar i kassa och bank</h3>
      <Manadslinje
        varden={tal.likviditet}
        idag={idag}
        etikett="Likviditet vid varje månadsskifte"
      />

      <h3>Vad pengarna gick till</h3>
      {tal.kostnader.length === 0 ? (
        <p className="tomt">Inga kostnader bokförda i år.</p>
      ) : (
        <Andelsstaplar poster={tal.kostnader} etikett="Kostnader per konto" />
      )}
    </>
  );
}
