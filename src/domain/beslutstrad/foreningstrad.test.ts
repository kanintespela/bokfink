import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import { kontonummer } from '../konto/konto';
import { sokMallar, tillampaMall } from '../mall/konteringsmall';
import { datum } from '../tid/datum';
import {
  allaLov,
  BESLUTSTRAD,
  lovForMallId,
  lovMallId,
  lovTillMall,
  momsForLov,
  stigTill,
  type Lov,
  type Nod,
} from './beslutstrad';
import { FORENINGSTRAD } from './foreningstrad';
import { beslutstradFor, betalsattsnamnFor } from './tradval';

const kr = oreFromKronor;
const leaves = allaLov(FORENINGSTRAD);

function lovet(id: string): Lov {
  const hittat = leaves.find((lov) => lov.id === id);
  if (hittat === undefined) {
    throw new Error(`Inget löv ${id}`);
  }
  return hittat;
}

function bokfor(id: string, belopp: string, betalkonto: string) {
  const lov = lovet(id);
  return tillampaMall(lovTillMall(lov, momsForLov(lov, datum('2026-10-30')).sats), {
    brutto: kr(belopp),
    betalkonto: kontonummer(betalkonto),
  }).map((rad) => [rad.konto, rad.belopp]);
}

function allaNoder(nod: Nod): Nod[] {
  return nod.typ === 'fraga'
    ? [nod, ...nod.svar.flatMap((svar) => allaNoder(svar.till))]
    : [nod];
}

describe("an association's tree", () => {
  it('asks something answerable at every question', () => {
    for (const nod of allaNoder(FORENINGSTRAD)) {
      if (nod.typ === 'fraga') {
        expect(nod.svar.length, nod.id).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("gives every leaf its own id, valid as an identifier and never a firm leaf's", () => {
    const idn = leaves.map((lov) => lovMallId(lov.id));
    expect(new Set(idn).size).toBe(leaves.length);
    const firmans = new Set(allaLov(BESLUTSTRAD).map((lov) => lovMallId(lov.id)));
    expect(idn.filter((id) => firmans.has(id))).toEqual([]);
    for (const lov of leaves) {
      expect(lov.id.startsWith('f-'), lov.id).toBe(true);
    }
  });

  it('shows every leaf its way in, and finds a leaf again from its mall id', () => {
    for (const lov of leaves) {
      expect(stigTill(lov.id, FORENINGSTRAD), lov.id).toBeDefined();
      expect(lovForMallId(lovMallId(lov.id), FORENINGSTRAD)?.id).toBe(lov.id);
    }
  });

  it('puts no moms on any leaf: an association without moms pays it as part of the cost', () => {
    for (const lov of leaves) {
      expect(lov.moms, lov.id).toEqual({ typ: 'fast', sats: 0 });
    }
  });

  it('names a source for every leaf', () => {
    for (const lov of leaves) {
      expect(lov.kalla.trim(), lov.id).not.toBe('');
    }
  });

  it('touches nothing that belongs to a firm or its owner', () => {
    const agare = ['2012', '2013', '2017', '2641', '2650', '2611', '2621', '2631'];
    for (const lov of leaves) {
      for (const konto of [lov.konto, ...lov.betalsatt]) {
        expect(agare, `${lov.id} ${konto}`).not.toContain(konto);
      }
    }
  });

  it('can pay from the bank, the cash box and the placeringskonto, and says so by name', () => {
    const namn = betalsattsnamnFor('forening');
    for (const lov of leaves) {
      for (const konto of lov.betalsatt) {
        expect(namn.get(konto), `${lov.id} ${konto}`).toBeDefined();
      }
    }
    expect(namn.get(kontonummer('1930'))).toBe('Bankkontot');
  });
});

describe('beslutstradFor', () => {
  it("is the firm's tree for a firm and the association's for an association", () => {
    expect(beslutstradFor('enskild_firma')).toBe(BESLUTSTRAD);
    expect(beslutstradFor('forening')).toBe(FORENINGSTRAD);
  });
});

describe('booking from the association tree', () => {
  it('books a bill for the whole amount on the cost, with no moms split off', () => {
    // 1 250 kr paid from the bank: all of it is the cost, none of it ingående moms.
    expect(bokfor('f-el', '1250', '1930')).toEqual([
      ['5020', kr('1250')],
      ['1930', kr('-1250')],
    ]);
  });

  it('books a membership fee as an intäkt on the moms-free account', () => {
    expect(bokfor('f-medlem', '300', '1930')).toEqual([
      ['1930', kr('300')],
      ['3610', kr('-300')],
    ]);
  });

  it('books a grant on the account for its giver', () => {
    expect(bokfor('f-bidrag-off', '40000', '1930')).toEqual([
      ['1930', kr('40000')],
      ['3710', kr('-40000')],
    ]);
    expect(bokfor('f-bidrag-eu', '40000', '1930')[1]).toEqual(['3730', kr('-40000')]);
  });

  it('takes a conditional grant as a skuld, not an intäkt (6.77)', () => {
    expect(bokfor('f-bidrag-vill', '40000', '1930')).toEqual([
      ['1930', kr('40000')],
      ['2900', kr('-40000')],
    ]);
  });

  it('takes a deposition as a skuld and gives it back as one', () => {
    expect(bokfor('f-deposition', '2000', '1930')).toEqual([
      ['1930', kr('2000')],
      ['2900', kr('-2000')],
    ]);
    expect(bokfor('f-depaterb', '2000', '1930')).toEqual([
      ['2900', kr('2000')],
      ['1930', kr('-2000')],
    ]);
  });

  it('moves cash to the bank without a cost or an intäkt', () => {
    // The bank takes the money in and the cash box gives it up.
    expect(bokfor('f-frankassan', '1500', '1930')).toEqual([
      ['1930', kr('1500')],
      ['1910', kr('-1500')],
    ]);
  });
});

describe('searching the association tree', () => {
  const mallar = leaves.map((lov) =>
    lovTillMall(lov, momsForLov(lov, datum('2026-10-30')).sats),
  );
  const forsta = (fraga: string) => {
    const traff = sokMallar(mallar, fraga, new Map());
    return traff[0] === undefined
      ? undefined
      : leaves.find((lov) => lovMallId(lov.id) === traff[0]!.id)?.id;
  };

  it('finds the common things by the words people use', () => {
    expect(forsta('elräkning')).toBe('f-el');
    expect(forsta('medlemsavgift')).toBe('f-medlem');
    expect(forsta('uthyrning')).toBe('f-hyra');
    expect(forsta('lotter')).toBe('f-lotter');
    expect(forsta('deposition')).toBeDefined();
  });
});
