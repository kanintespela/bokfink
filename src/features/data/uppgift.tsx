import { useState } from 'react';

/**
 * One long-running job at a time, and what it said afterwards.
 *
 * Every screen that writes files or reads them needs the same three things:
 * a flag to disable its buttons while it works, a line saying how it went,
 * and a line saying what went wrong. Shared rather than copied, so the
 * failure half cannot quietly diverge - an error that is swallowed on one
 * screen and shown on another is hard rule 11 broken in the place nobody
 * looks.
 */
export function useUppgift() {
  const [arbetar, setArbetar] = useState(false);
  const [besked, setBesked] = useState<string | undefined>();
  const [fel, setFel] = useState<string | undefined>();

  async function kor(uppgift: () => Promise<string>) {
    setArbetar(true);
    setBesked(undefined);
    setFel(undefined);
    try {
      setBesked(await uppgift());
    } catch (orsak) {
      // Hard rule 11: shown, not swallowed.
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setArbetar(false);
    }
  }

  return { arbetar, besked, fel, kor };
}

interface Statusprops {
  readonly arbetar: boolean;
  readonly besked: string | undefined;
  readonly fel: string | undefined;
}

/** The three lines a job leaves behind, at the foot of the screen that ran it. */
export function Uppgiftsstatus({ arbetar, besked, fel }: Statusprops) {
  return (
    <>
      {arbetar && <p data-testid="datautbyte-arbetar">Arbetar …</p>}

      {besked !== undefined && (
        <p className="kort" role="status" data-testid="datautbyte-besked">
          {besked}
        </p>
      )}

      {fel !== undefined && (
        <p role="alert" data-testid="datautbyte-fel">
          {fel}
        </p>
      )}
    </>
  );
}
