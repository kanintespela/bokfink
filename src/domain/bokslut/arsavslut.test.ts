import { describe, expect, it } from 'vitest';

import { datum } from '../tid/datum';
import { nastaRakenskapsarsperiod } from './arsavslut';

describe('nastaRakenskapsarsperiod', () => {
  it('följer direkt efter ett normalt kalenderår, utan lucka eller överlapp', () => {
    const nasta = nastaRakenskapsarsperiod({
      start: datum('2026-01-01'),
      slut: datum('2026-12-31'),
    });
    expect(nasta).toEqual({ start: datum('2027-01-01'), slut: datum('2027-12-31') });
  });

  it('ger ett fullt kalenderår även när det föregående var ett skottår', () => {
    const nasta = nastaRakenskapsarsperiod({
      start: datum('2028-01-01'),
      slut: datum('2028-12-31'),
    });
    expect(nasta).toEqual({ start: datum('2029-01-01'), slut: datum('2029-12-31') });
  });

  it('ger ett normalt kalenderår efter ett förlängt artonmånaders förstaår', () => {
    // Bokföringslagen 3 kap. 3 §: ett förlängt första år finns för att låta
    // efterföljande år landa på en ren kalendergräns - inte för att samma
    // längd ska upprepas.
    const nasta = nastaRakenskapsarsperiod({
      start: datum('2026-07-01'),
      slut: datum('2027-12-31'),
    });
    expect(nasta).toEqual({ start: datum('2028-01-01'), slut: datum('2028-12-31') });
  });
});
