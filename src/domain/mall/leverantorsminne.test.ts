import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Uuid } from '../id/uuidv7';
import { datum } from '../tid/datum';
import { tolkaKvitto } from '../underlag/kvittotolkning';
import type { Underlag } from '../underlag/underlag';
import type { BokfortVerifikat } from '../verifikat/verifikat';
import { foreslaFranTidigare, tidigareKop, type TidigareKop } from './leverantorsminne';

const FODER = 'foder' as Uuid;
const VERKTYG = 'verktyg' as Uuid;

const kop = (over: Partial<TidigareKop>): TidigareKop => ({
  mall: FODER,
  datum: datum('2026-09-01'),
  ...over,
});

describe('foreslaFranTidigare', () => {
  it('follows the last purchase from the same organisationsnummer', () => {
    const forslag = foreslaFranTidigare({ orgnr: '5560000001' }, [
      kop({ orgnr: '556000-0001', mall: VERKTYG, datum: datum('2026-03-01') }),
      kop({ orgnr: '556000-0001', mall: FODER, datum: datum('2026-09-01') }),
    ]);

    expect(forslag?.mall).toBe(FODER);
    expect(forslag?.forebild.datum).toBe('2026-09-01');
  });

  /* OCR reads the number right far more often than the name. */
  it('trusts the number over a name that happens to match', () => {
    expect(
      foreslaFranTidigare({ orgnr: '5560000001', leverantor: 'Agro' }, [
        kop({ orgnr: '5560000000', leverantor: 'Agro' }),
      ]),
    ).toBeUndefined();
  });

  it('falls back on the name when there is no number to compare', () => {
    expect(
      foreslaFranTidigare({ leverantor: 'Exenpel  Lantbruk' }, [
        kop({ leverantor: 'exenpel lantbruk', mall: VERKTYG }),
      ])?.mall,
    ).toBe(VERKTYG);
  });

  it('suggests nothing for a supplier never booked before', () => {
    expect(foreslaFranTidigare({ leverantor: 'Ny butik' }, [kop({})])).toBeUndefined();
    expect(foreslaFranTidigare({}, [kop({ leverantor: 'Agro' })])).toBeUndefined();
  });
});

describe('tidigareKop', () => {
  const IDAG = datum('2026-10-28');
  const text = readFileSync(
    new URL('./__fixtures__/lantbruksbutik.txt', import.meta.url),
    'utf8',
  );
  const VERIFIKAT = 'v1' as Uuid;

  /*
   * The whole way round: a receipt booked as feed, then the next receipt
   * from the same shop. The shop's name is misread on both ("Exenpel"), and
   * the organisationsnummer is what ties them together.
   */
  it('remembers a booked receipt for the next one from the same shop', () => {
    const underlag = [{ text, verifikat: [VERIFIKAT] } as unknown as Underlag];
    const verifikat = new Map([
      [VERIFIKAT, { mall: FODER, datum: datum('2026-10-02') } as BokfortVerifikat],
    ]);

    const kop = tidigareKop(underlag, verifikat, IDAG);
    expect(kop).toHaveLength(1);
    expect(kop[0]?.orgnr).toBeDefined();

    expect(foreslaFranTidigare(tolkaKvitto(text, IDAG), kop)?.mall).toBe(FODER);
  });

  it('leaves out receipts never read or never booked', () => {
    const underlag = [
      { verifikat: [VERIFIKAT] } as unknown as Underlag,
      { text, verifikat: [] } as unknown as Underlag,
      { text, verifikat: ['utkast' as Uuid] } as unknown as Underlag,
    ];
    const verifikat = new Map([
      [VERIFIKAT, { mall: FODER, datum: datum('2026-10-02') } as BokfortVerifikat],
    ]);

    expect(tidigareKop(underlag, verifikat, IDAG)).toEqual([]);
  });
});
