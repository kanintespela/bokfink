import { FLIKAR, VYNAMN, type Vy } from './vy';

interface Props {
  readonly vy: Vy;
  readonly onValj: (vy: Vy) => void;
}

/** The switch between views, at the bottom where a thumb reaches it. */
export function Vyval({ vy, onValj }: Props) {
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
        </button>
      ))}
    </nav>
  );
}
