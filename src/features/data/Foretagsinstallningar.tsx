interface Props {
  readonly organisationsnummer: string;
  readonly onOrganisationsnummer: (nummer: string) => Promise<void>;
}

/** The few things about the business itself that the app has to know. */
export function Foretagsinstallningar({
  organisationsnummer,
  onOrganisationsnummer,
}: Props) {
  return (
    <section aria-label="Företaget">
      <h2>Företaget</h2>

      <div className="faltgrupp">
        <label htmlFor="orgnr">Organisationsnummer</label>
        <input
          id="orgnr"
          className="falt"
          inputMode="numeric"
          autoComplete="off"
          placeholder="ÅÅMMDD-NNNN"
          value={organisationsnummer}
          onChange={(handelse) => void onOrganisationsnummer(handelse.target.value)}
        />
      </div>

      <p>
        För enskild firma är det innehavarens personnummer, med eller utan sekelsiffror.
        Det behövs bara för momsdeklarationen och lämnar aldrig enheten.
      </p>
    </section>
  );
}
