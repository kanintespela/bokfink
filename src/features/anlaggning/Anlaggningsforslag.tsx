import { useEffect, useRef } from 'react';

import type { Anlaggningskop } from '../../domain/anlaggning/anlaggningskop';
import { formatKronor } from '../../domain/belopp/ore';
import { SLAGNAMN } from './Oregistreradekop';

/**
 * Said right after an asset has been booked: it is not in the register yet,
 * and here is the way there.
 *
 * Brought into view when it appears. It stands above whatever screen the
 * booking was made on, and after a booking that screen is scrolled down to
 * where the button was - a suggestion nobody sees is one nobody was given.
 */
export function Anlaggningsforslag({
  kop,
  onLaggIn,
}: {
  readonly kop: Anlaggningskop;
  readonly onLaggIn: () => void;
}) {
  const rad = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    rad.current?.scrollIntoView({ block: 'center' });
  }, []);

  return (
    <p className="kort" role="status" ref={rad} data-testid="anlaggningsforslag">
      <strong>{kop.verifikat.beskrivning}</strong> ({formatKronor(kop.belopp)}) är bokfört
      som {SLAGNAMN[kop.slag].toLocaleLowerCase('sv')} och finns inte i
      anläggningsregistret än.{' '}
      <button type="button" className="knapp" onClick={onLaggIn}>
        Lägg in i registret
      </button>
    </p>
  );
}
