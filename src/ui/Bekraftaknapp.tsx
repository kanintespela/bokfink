import { useState, type ReactNode } from 'react';

interface Props {
  /** The test id of the first button; the confirming one gets "-ja" after it. */
  readonly testId: string;
  readonly children: ReactNode;
  /** What cannot be undone, said in a sentence. */
  readonly fraga: string;
  /** The words on the button that actually does it. */
  readonly jaText: string;
  readonly onBekrafta: () => void;
  readonly disabled?: boolean;
}

/**
 * A button for something that cannot be taken back.
 *
 * The first press only asks. A lock of a period or a closed year is final,
 * and a thumb on a phone lands on the wrong button often enough that the
 * text saying so above it is not protection.
 */
export function Bekraftaknapp({
  testId,
  children,
  fraga,
  jaText,
  onBekrafta,
  disabled,
}: Props) {
  const [fragar, setFragar] = useState(false);

  if (!fragar) {
    return (
      <button
        type="button"
        className="knapp"
        disabled={disabled}
        data-testid={testId}
        onClick={() => setFragar(true)}
      >
        {children}
      </button>
    );
  }

  return (
    <div className="kort" role="group" aria-label="Bekräfta">
      <p>
        <strong>{fraga}</strong>
      </p>
      <button
        type="button"
        className="knapp knapp--primar"
        disabled={disabled}
        data-testid={`${testId}-ja`}
        onClick={() => {
          setFragar(false);
          onBekrafta();
        }}
      >
        {jaText}
      </button>
      <button
        type="button"
        className="knapp knapp--text"
        onClick={() => setFragar(false)}
      >
        Avbryt
      </button>
    </div>
  );
}
