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
  const hjalp = beloppshjalp(varde);

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
        aria-invalid={hjalp !== undefined}
        aria-describedby={hjalp === undefined ? undefined : `${id}-hjalp`}
        onChange={(handelse) => onChange(handelse.target.value)}
      />
      {hjalp !== undefined && (
        <p
          id={`${id}-hjalp`}
          role="alert"
          className="hjalptext"
          data-testid="beloppshjalp"
        >
          {hjalp}
        </p>
      )}
    </div>
  );
}

/** A billion kronor: past this it is a slip of the finger, not a booking. */
const STORSTA_BELOPP = oreFromKronor('999999999.99');

/** The amount if it can be read, undefined while it is still being typed. */
export function tolkaBelopp(text: string): Ore | undefined {
  const rensat = text.replace(/\s/g, '');
  if (rensat.length === 0) {
    return undefined;
  }
  try {
    const belopp = oreFromKronor(rensat);
    return Math.abs(belopp) > STORSTA_BELOPP ? undefined : belopp;
  } catch {
    return undefined;
  }
}

/**
 * Why an amount cannot be read, in words, or undefined when nothing is wrong.
 *
 * A half-written amount ("12,") is not wrong, it is unfinished. Without this
 * the Bokför button was simply disabled for "1.234,56" and "10,005", and
 * nothing said why.
 */
export function beloppshjalp(text: string): string | undefined {
  const rensat = text.replace(/\s/g, '');
  if (rensat.length === 0 || /^-?[,.]?$/.test(rensat) || /^-?\d+[,.]$/.test(rensat)) {
    return undefined;
  }
  if (tolkaBelopp(rensat) !== undefined) {
    return undefined;
  }
  if (/^-?\d{1,3}(\.\d{3})+(,\d*)?$/.test(rensat)) {
    return 'Skriv beloppet utan punkt som tusentalsavgränsare, till exempel 1234,56 eller 1 234,56.';
  }
  if (/^-?\d+[,.]\d{3,}$/.test(rensat)) {
    return 'Ange högst två decimaler (öre).';
  }
  if (/^-?\d+([,.]\d*)?$/.test(rensat)) {
    return 'Beloppet är för stort.';
  }
  return 'Skriv bara siffror och komma för öre, till exempel 520,31.';
}

export function visaBelopp(belopp: Ore): string {
  return `${formatKronor(belopp)} kr`;
}
