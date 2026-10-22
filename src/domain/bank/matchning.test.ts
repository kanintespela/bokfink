import { describe, expect, it } from 'vitest';

import { negate, oreFromKronor } from '../belopp/ore';
import { kontonummer } from '../konto/konto';
import type { Uuid } from '../id/uuidv7';
import { datum } from '../tid/datum';
import { verifikatserie } from '../verifikat/serie';
import { bokfor, skapaUtkast, type BokfortVerifikat } from '../verifikat/verifikat';
import type { Banktransaktion } from './kontoutdrag';
import { matchaKontoutdrag, saknasIBokforingen } from './matchning';

const FORETAGSKONTO = kontonummer('1930');
const kr = (text: string) => oreFromKronor(text);

let raknare = 0;

function verifikat(datumtext: string, kontobelopp: string): BokfortVerifikat {
  raknare += 1;
  const belopp = kr(kontobelopp);
  return bokfor(
    skapaUtkast({
      id: `019b76da-a800-7000-8000-${String(raknare).padStart(12, '0')}` as Uuid,
      datum: datum(datumtext),
      beskrivning: 'Inköp',
      konteringar: [
        // The other side, so the verifikat balances. Negated rather than
        // written out, which would put the amount through a float.
        { konto: kontonummer('4010'), belopp: negate(belopp) },
        { konto: FORETAGSKONTO, belopp },
      ],
    }),
    {
      serie: verifikatserie('A'),
      nummer: raknare,
      bokfortDatum: datum(datumtext),
      kalla: 'manuell',
    },
  );
}

const rad = (datumtext: string, belopp: string, text = 'Kortköp'): Banktransaktion => ({
  datum: datum(datumtext),
  text,
  belopp: kr(belopp),
});

describe('matchaKontoutdrag', () => {
  it('pairs a line with the booking that already records it', () => {
    const bokfort = verifikat('2026-02-13', '-520.31');
    const matchningar = matchaKontoutdrag(
      [rad('2026-02-14', '-520.31')],
      [bokfort],
      FORETAGSKONTO,
    );

    expect(matchningar[0]?.verifikat?.id).toBe(bokfort.id);
    expect(saknasIBokforingen(matchningar)).toEqual([]);
  });

  it('leaves a line unmatched when nothing in the books fits', () => {
    const matchningar = matchaKontoutdrag(
      [rad('2026-02-14', '-520.31')],
      [verifikat('2026-02-13', '-99.00')],
      FORETAGSKONTO,
    );

    expect(matchningar[0]?.verifikat).toBeUndefined();
    expect(saknasIBokforingen(matchningar)).toHaveLength(1);
  });

  /*
   * The failure that would make the whole feature counterproductive: an
   * almost equal amount is a different purchase, and calling it the same one
   * hides the transaction the import exists to find.
   */
  it('requires the amount to be exact', () => {
    const matchningar = matchaKontoutdrag(
      [rad('2026-02-13', '-520.31')],
      [verifikat('2026-02-13', '-520.30')],
      FORETAGSKONTO,
    );
    expect(matchningar[0]?.verifikat).toBeUndefined();
  });

  it('allows the bank a few days to settle', () => {
    const bokfort = verifikat('2026-02-13', '-520.31');
    const inom = matchaKontoutdrag(
      [rad('2026-02-17', '-520.31')],
      [bokfort],
      FORETAGSKONTO,
    );
    const utanfor = matchaKontoutdrag(
      [rad('2026-02-25', '-520.31')],
      [bokfort],
      FORETAGSKONTO,
    );

    expect(inom[0]?.verifikat?.id).toBe(bokfort.id);
    expect(utanfor[0]?.verifikat).toBeUndefined();
  });

  /*
   * Two identical purchases in one week are two lines and two bookings. If
   * both lines took the same booking, one would be reported as missing and
   * booked a second time - the duplicate this is meant to prevent.
   */
  it('uses each booking once', () => {
    const forsta = verifikat('2026-02-13', '-99.00');
    const andra = verifikat('2026-02-14', '-99.00');
    const matchningar = matchaKontoutdrag(
      [rad('2026-02-13', '-99.00'), rad('2026-02-14', '-99.00')],
      [forsta, andra],
      FORETAGSKONTO,
    );

    const ider = matchningar.map((matchning) => matchning.verifikat?.id);
    expect(new Set(ider).size).toBe(2);
    expect(ider).not.toContain(undefined);
  });

  it('reports a line as missing when only one of two identical ones is booked', () => {
    const matchningar = matchaKontoutdrag(
      [rad('2026-02-13', '-99.00'), rad('2026-02-14', '-99.00')],
      [verifikat('2026-02-13', '-99.00')],
      FORETAGSKONTO,
    );
    expect(saknasIBokforingen(matchningar)).toHaveLength(1);
  });

  it('ignores bookings that never touched the account', () => {
    const kontant = bokfor(
      skapaUtkast({
        id: '019b76da-a800-7000-8000-0000000000ff' as Uuid,
        datum: datum('2026-02-13'),
        beskrivning: 'Betalt privat',
        konteringar: [
          { konto: kontonummer('4010'), belopp: kr('520.31') },
          { konto: kontonummer('2013'), belopp: kr('-520.31') },
        ],
      }),
      {
        serie: verifikatserie('A'),
        nummer: 99,
        bokfortDatum: datum('2026-02-13'),
        kalla: 'manuell',
      },
    );

    const matchningar = matchaKontoutdrag(
      [rad('2026-02-13', '-520.31')],
      [kontant],
      FORETAGSKONTO,
    );
    expect(matchningar[0]?.verifikat).toBeUndefined();
  });

  it('matches money coming in as well as going out', () => {
    const inbetalning = verifikat('2026-02-10', '12645.00');
    const matchningar = matchaKontoutdrag(
      [rad('2026-02-10', '12645.00', 'FAKTURA 4417')],
      [inbetalning],
      FORETAGSKONTO,
    );
    expect(matchningar[0]?.verifikat?.id).toBe(inbetalning.id);
  });
});
