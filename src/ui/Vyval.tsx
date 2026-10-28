import { FLIKAR, VYNAMN, type Vy } from './vy';

interface Props {
  readonly vy: Vy;
  readonly onValj: (vy: Vy) => void;
  /** What waits behind a tab, shown as a number on it when there is any. */
  readonly antal?: Partial<Record<Vy, number>>;
}

/** The switch between views, at the bottom where a thumb reaches it. */
export function Vyval({ vy, onValj, antal = {} }: Props) {
  return (
    <nav className="vyval" aria-label="Vyer">
      {FLIKAR.map((kandidat) => (
        <button
          key={kandidat}
          type="button"
          aria-current={vy === kandidat ? 'page' : undefined}
          onClick={() => onValj(kandidat)}
        >
          {VYNAMN[kandidat]}
          {(antal[kandidat] ?? 0) > 0 && (
            <span className="vyval__antal">{antal[kandidat]}</span>
          )}
        </button>
      ))}
    </nav>
  );
}
