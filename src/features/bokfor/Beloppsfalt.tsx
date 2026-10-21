import { useEffect, useId, useRef } from 'react';

import { formatKronor, oreFromKronor, type Ore } from '../../domain/belopp/ore';

interface Props {
  readonly varde: string;
  readonly onChange: (varde: string) => void;
  readonly etikett?: string;
  /** Put the cursor here on mount, once a template has been chosen. */
  readonly fokusera?: boolean;
}

/**
 * The amount, and the first thing on the screen.
 *
 * inputMode="decimal" so a phone offers the numeric keypad without the field
 * becoming type="number", which on iOS strips a leading zero, refuses a comma
 * and silently accepts scientific notation. The text is kept as typed and
 * only turned into öre when it parses, so a half-written "12," is a state the
 * field can be in rather than an error.
 */
export function Beloppsfalt({ varde, onChange, etikett = 'Belopp', fokusera }: Props) {
  const id = useId();
  const falt = useRef<HTMLInputElement>(null);

  /*
   * Focused from an effect rather than with the autoFocus attribute. This
   * only happens after a deliberate choice of template, so the keyboard
   * appearing is what was asked for rather than a page grabbing the cursor
   * on load.
   */
  useEffect(() => {
    if (fokusera) {
      falt.current?.focus();
    }
  }, [fokusera]);

  return (
    <div className="faltgrupp">
      <label htmlFor={id}>{etikett}</label>
      <input
        id={id}
        ref={falt}
        className="falt falt--belopp"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,00"
        value={varde}
        onChange={(handelse) => onChange(handelse.target.value)}
      />
    </div>
  );
}

/** The amount if it can be read, undefined while it is still being typed. */
export function tolkaBelopp(text: string): Ore | undefined {
  const rensat = text.replace(/\s/g, '');
  if (rensat.length === 0) {
    return undefined;
  }
  try {
    return oreFromKronor(rensat);
  } catch {
    return undefined;
  }
}

export function visaBelopp(belopp: Ore): string {
  return `${formatKronor(belopp)} kr`;
}
