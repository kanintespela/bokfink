import type { Anlaggningstillgang } from '../../domain/anlaggning/anlaggningstillgang';
import type { Fastighetstillgang } from '../../domain/anlaggning/fastighetstillgang';
import { formatKronor, isZero, type Ore } from '../../domain/belopp/ore';
import type { Uuid } from '../../domain/id/uuidv7';
import type { Datum } from '../../domain/tid/datum';
import { kopt } from './Oregistreradekop';

interface Rad {
  readonly id: Uuid;
  readonly benamning: string;
  readonly slag: string;
  readonly typ: 'forsaljning' | 'utrangering';
  readonly datum: Datum;
  readonly inkomst: Ore;
  readonly anskaffningsvarde: Ore;
  readonly verifikatId: Uuid | undefined;
}

const FASTIGHETSSLAG = {
  byggnad: 'Byggnad',
  markanlaggning: 'Markanläggning',
  mark: 'Mark',
  skog: 'Skog',
} as const;

/**
 * What has been sold or scrapped, kept apart from what is owned.
 *
 * Listed among the owned entries they read as part of the holding. They stay
 * in the register - the year's sales are part of it - but folded away, newest
 * first, with when and for how much.
 */
export function Saldaposter({
  anlaggningar,
  fastigheter,
  verifikatnamn,
}: {
  readonly anlaggningar: readonly Anlaggningstillgang[];
  readonly fastigheter: readonly Fastighetstillgang[];
  readonly verifikatnamn: ReadonlyMap<Uuid, string>;
}) {
  const rader: Rad[] = [];
  for (const post of anlaggningar) {
    if (post.avyttring !== undefined) {
      rader.push({
        id: post.id,
        benamning: post.benamning,
        slag: 'Maskin eller inventarie',
        typ: post.avyttring.typ,
        datum: post.avyttring.datum,
        inkomst: post.avyttring.forsaljningsinkomst,
        anskaffningsvarde: post.anskaffningsvarde,
        verifikatId: post.verifikatId,
      });
    }
  }
  for (const post of fastigheter) {
    if (post.avyttring !== undefined) {
      rader.push({
        id: post.id,
        benamning: post.benamning,
        slag: FASTIGHETSSLAG[post.kategori.typ],
        typ: post.avyttring.typ,
        datum: post.avyttring.datum,
        inkomst: post.avyttring.forsaljningsinkomst,
        anskaffningsvarde: post.anskaffningsvarde,
        verifikatId: post.verifikatId,
      });
    }
  }
  if (rader.length === 0) {
    return null;
  }
  rader.sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));

  return (
    <details data-testid="salda-poster">
      <summary>Sålda och utrangerade ({rader.length})</summary>
      <ul className="lista">
        {rader.map((rad) => (
          <li key={rad.id}>
            <div className="listrad">
              <span className="listrad__text">
                <span>{rad.benamning}</span>
                <span className="listrad__sekundar">
                  {rad.slag} · {rad.typ === 'forsaljning' ? 'Sålt' : 'Utrangerat'}{' '}
                  {rad.datum}
                  {rad.typ === 'forsaljning' && !isZero(rad.inkomst)
                    ? ` för ${formatKronor(rad.inkomst)}`
                    : ''}
                  {kopt(rad.verifikatId, verifikatnamn)}
                </span>
              </span>
              <span className="belopp">{formatKronor(rad.anskaffningsvarde)}</span>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
