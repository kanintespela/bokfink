import { FLIKAR, VYNAMN, type Vy } from './vy';

interface Props {
  readonly vy: Vy;
  readonly onValj: (vy: Vy) => void;
  /** What waits behind a tab, shown as a number on it when there is any. */
  readonly antal?: Partial<Record<Vy, number>>;
  /**
   * The open book, shown as a thin line above the tabs when there are several
   * books. The bar is where a thumb is and nothing is under it, and it is not
   * the top edge of the screen, where iOS blurs whatever sits.
   */
  readonly bok?: { readonly namn: string; readonly onByt?: () => void };
}

/** The switch between views, at the bottom where a thumb reaches it. */
export function Vyval({ vy, onValj, antal = {}, bok }: Props) {
  return (
    <nav className={bok === undefined ? 'vyval' : 'vyval vyval--bok'} aria-label="Vyer">
      {bok !== undefined &&
        (bok.onByt === undefined ? (
          <p className="vyval__bok" data-testid="aktiv-bok">
            Bok: <strong>{bok.namn}</strong>
          </p>
        ) : (
          <button
            type="button"
            className="vyval__bok"
            data-testid="aktiv-bok"
            aria-label={`Byt bok. Öppen bok: ${bok.namn}`}
            onClick={bok.onByt}
          >
            Bok: <strong>{bok.namn}</strong>
          </button>
        ))}
      <div className="vyval__flikar">
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
      </div>
    </nav>
  );
}
