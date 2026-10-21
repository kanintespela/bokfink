interface Props {
  readonly serie: string;
  readonly onSerie: (serie: string) => Promise<void>;
}

/** What makes this installation different from the other ones. */
export function Enhetsinstallningar({ serie, onSerie }: Props) {
  return (
    <section aria-label="Den här enheten">
      <h2>Den här enheten</h2>

      <div className="faltgrupp">
        <label htmlFor="enhetsserie">Verifikatserie</label>
        <input
          id="enhetsserie"
          className="falt"
          value={serie}
          maxLength={4}
          autoComplete="off"
          onChange={(handelse) => void onSerie(handelse.target.value)}
        />
      </div>

      <p>
        Varje enhet delar ut nummer i sin egen serie, så att telefonen och datorn kan
        bokföra utan att fråga varandra. Ge dem olika bokstäver.
      </p>
    </section>
  );
}
