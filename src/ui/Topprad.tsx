interface Props {
  /** The open book, named when there are several; an empty bar otherwise. */
  readonly bok?: { readonly namn: string; readonly onByt?: () => void };
}

/**
 * A solid bar stuck to the top of the screen (sticky, top 0), which stays when the page scrolls. The status bar
 * sits over it, and it is solid, so the system's fade of the scrolling page
 * under the status bar lands on this bar rather than on the page's content.
 */
export function Topprad({ bok }: Props) {
  return (
    <header className="topprad">
      {bok === undefined ? (
        <div className="topprad__rad" />
      ) : bok.onByt === undefined ? (
        <p className="topprad__rad" data-testid="aktiv-bok">
          Bok: <strong>{bok.namn}</strong>
        </p>
      ) : (
        <div className="topprad__rad">
          <button
            type="button"
            className="topprad__bok"
            data-testid="aktiv-bok"
            aria-label={`Byt bok. Öppen bok: ${bok.namn}`}
            onClick={bok.onByt}
          >
            Bok: <strong>{bok.namn}</strong>
          </button>
        </div>
      )}
    </header>
  );
}
