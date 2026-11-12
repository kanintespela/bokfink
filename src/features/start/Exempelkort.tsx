import { Bekraftaknapp } from '../../ui/Bekraftaknapp';

interface Props {
  /** Takes the example book away for good and opens the first book. */
  readonly onTaBort: () => void;
}

/**
 * Says that the open book is the example, at the top of its overview.
 *
 * The name in the top bar already says so, but only to someone who reads it.
 * The danger here is real bookkeeping typed into a book made to be thrown
 * away, so the card says it plainly and has the way out beside it.
 */
export function Exempelkort({ onTaBort }: Props) {
  return (
    <div className="kort" data-testid="exempelkort">
      <strong>Det här är en exempelbok med påhittade uppgifter.</strong>
      <p className="hjalptext">
        Titta runt och bokför gärna något för att prova. Lägg inte in din riktiga
        bokföring här: boken är till för att tas bort. Din egen bok ligger kvar orörd och
        öppnas under Mer, Böcker.
      </p>
      <Bekraftaknapp
        testId="ta-bort-exempel"
        fraga="Exempelboken tas bort för gott. Din egen bok öppnas i stället."
        jaText="Ta bort exempelboken"
        onBekrafta={onTaBort}
      >
        Ta bort exempelboken
      </Bekraftaknapp>
    </div>
  );
}
