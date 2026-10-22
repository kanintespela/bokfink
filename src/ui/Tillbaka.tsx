interface Props {
  readonly onTillbaka: () => void;
}

/**
 * The way out of a screen reached from a menu.
 *
 * At the top rather than the bottom: these screens are long, and a way back
 * that has to be scrolled to is one people leave the app to avoid. The
 * phone's own back gesture works too (the view lives in the address), but
 * the button is what a hand finds first.
 */
export function Tillbaka({ onTillbaka }: Props) {
  return (
    <p>
      <button type="button" className="knapp knapp--text" onClick={onTillbaka}>
        Tillbaka
      </button>
    </p>
  );
}
