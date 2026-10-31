import type { Uuid } from '../../domain/id/uuidv7';
import type { Projekt } from '../../domain/projekt/projekt';

interface Props {
  readonly id: string;
  readonly etikett: string;
  readonly projekt: readonly Projekt[];
  /** The project chosen, or empty for none. */
  readonly varde: Uuid | '';
  readonly onAndra: (valt: Uuid | '') => void;
}

/**
 * The choice of project for a rad: none, or one of the open ones.
 *
 * Left out altogether while there are no projects, so a book that does not use
 * them never sees the field. A finished project is offered only when the rad
 * already has it, so that changing a draft does not drop it unseen; booking it
 * is refused with the reason, not here.
 */
export function Projektval({ id, etikett, projekt, varde, onAndra }: Props) {
  const val = projekt.filter((post) => !post.avslutat || post.id === varde);
  if (val.length === 0) {
    return null;
  }
  return (
    <div className="faltgrupp">
      <label htmlFor={id}>{etikett}</label>
      <select
        id={id}
        className="falt"
        value={varde}
        onChange={(handelse) => onAndra(handelse.target.value as Uuid | '')}
      >
        <option value="">Inget projekt</option>
        {val.map((post) => (
          <option key={post.id} value={post.id}>
            {post.kod} {post.namn}
            {post.avslutat ? ' (avslutat)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
