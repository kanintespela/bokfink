import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  allaLov,
  lovForMallId,
  lovTillMall,
  momsForLov,
} from '../beslutstrad/beslutstrad';
import { datum } from '../tid/datum';
import { foreslaMallForText } from './kvittomall';

/**
 * Real receipts, as the phone's OCR read them, against the real leaves.
 *
 * The unit tests above use made-up templates; these are the cases that were
 * wrong in use, kept so they stay right.
 */
const IDAG = datum('2026-10-28');
const MALLAR = allaLov().map((lov) => lovTillMall(lov, momsForLov(lov, IDAG).sats));

function las(namn: string): string {
  return readFileSync(new URL(`./__fixtures__/${namn}`, import.meta.url), 'utf8');
}

describe('foreslaMallForText on real receipts', () => {
  /*
   * 2026-10-28: offered as "Fått tillbaka moms" because of the word "moms"
   * in "Totalt inkl. moms". Salt licks for the animals are feed.
   */
  it('reads salt licks from a farm shop as feed', () => {
    const forslag = foreslaMallForText(MALLAR, las('lantbruksbutik.txt'));

    expect(forslag?.traff).toBe('saltsten');
    expect(lovForMallId(forslag!.mall.id)?.namn).toBe('Foder och strö');
  });
});
