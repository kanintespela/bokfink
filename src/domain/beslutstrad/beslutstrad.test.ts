import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import { kontonummer } from '../konto/konto';
import { tillampaMall } from '../mall/konteringsmall';
import { datum } from '../tid/datum';
import {
  allaLov,
  BESLUTSTRAD,
  BETALSATTSNAMN,
  lovForMallId,
  lovMallId,
  lovTillMall,
  momsForLov,
  stigTill,
  type Fraga,
  type Lov,
  type Nod,
} from './beslutstrad';

const kr = oreFromKronor;

function lovet(id: string): Lov {
  const hittat = allaLov().find((lov) => lov.id === id);
  if (hittat === undefined) {
    throw new Error(`Inget löv ${id}`);
  }
  return hittat;
}

/** Books a leaf the way the form does, at its proposed rate. */
function bokfor(id: string, belopp: string, betalkonto: string, dag = '2026-09-13') {
  const lov = lovet(id);
  return tillampaMall(lovTillMall(lov, momsForLov(lov, datum(dag)).sats), {
    brutto: kr(belopp),
    betalkonto: kontonummer(betalkonto),
  }).map((rad) => [rad.konto, rad.belopp]);
}

function allaNoder(nod: Nod): Nod[] {
  return nod.typ === 'fraga'
    ? [nod, ...nod.svar.flatMap((svar) => allaNoder(svar.till))]
    : [nod];
}

describe('the tree', () => {
  it('asks something answerable at every question', () => {
    for (const nod of allaNoder(BESLUTSTRAD)) {
      if (nod.typ === 'fraga') {
        expect(nod.svar.length, nod.id).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('gives every leaf its own id, and one that makes a valid identifier', () => {
    const lov = allaLov();
    const idn = lov.map((l) => lovMallId(l.id));
    expect(new Set(idn).size).toBe(lov.length);
    for (const id of idn) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it('never lets two different leaves share an id', () => {
    const perId = new Map<string, Lov>();
    for (const nod of allaNoder(BESLUTSTRAD)) {
      if (nod.typ !== 'lov') continue;
      const tidigare = perId.get(nod.id);
      expect(tidigare === undefined || tidigare === nod, nod.id).toBe(true);
      perId.set(nod.id, nod);
    }
  });

  it('offers named ways to pay, never the account being booked itself', () => {
    for (const lov of allaLov()) {
      expect(lov.betalsatt.length, lov.id).toBeGreaterThan(0);
      expect(lov.betalsatt, lov.id).not.toContain(lov.konto);
      for (const konto of lov.betalsatt) {
        expect(BETALSATTSNAMN.has(konto), `${lov.id} ${konto}`).toBe(true);
      }
      expect(lov.kalla.length, lov.id).toBeGreaterThan(0);
    }
  });

  it('starts with the four ways money moves, and the year end', () => {
    expect(BESLUTSTRAD.svar.map((svar) => svar.text)).toEqual([
      'Pengar ut',
      'Pengar in',
      'Flytta pengar',
      'Moms',
      'Vid årets slut',
    ]);
  });

  it('finds the leaf again from the id a verifikat carries', () => {
    expect(lovForMallId(lovMallId('foder'))?.namn).toBe('Foder och strö');
    expect(lovForMallId(lovMallId('finns-inte'))).toBeUndefined();
  });

  it('says where a leaf sits', () => {
    expect(stigTill('foder')).toEqual(['Pengar ut', 'Djuren']);
    expect(stigTill('inventarie')).toEqual([
      'Pengar ut',
      'Maskiner, verktyg och material',
      'Köpt en maskin, ett verktyg eller en inventarie',
    ]);
  });

  it('refuses an id that would not fit in an identifier', () => {
    expect(() => lovMallId('ett-alldeles-for-langt-id')).toThrow('1-15 tecken');
    expect(() => lovMallId('Foder')).toThrow();
  });

  it('asks about half a prisbasbelopp before a machine becomes an asset', () => {
    const maskiner = BESLUTSTRAD.svar[0]!.till as Fraga;
    const fraga = allaNoder(maskiner).find(
      (nod): nod is Fraga => nod.typ === 'fraga' && nod.id === 'inventarie',
    );
    expect(fraga?.visaHalvtPrisbasbelopp).toBe(true);
    expect(fraga?.svar.map((svar) => (svar.till as Lov).konto)).toEqual(['1221', '5400']);
  });
});

describe('momsForLov', () => {
  const livsmedel = () => lovet('salt-livsmedel');

  // Skatteverket 2026: 6 % from 1 April 2026 through 31 December 2027.
  it('takes 12 % on food up to 31 March 2026 and 6 % from 1 April', () => {
    expect(momsForLov(livsmedel(), datum('2026-03-31')).sats).toBe(12);
    expect(momsForLov(livsmedel(), datum('2026-04-01')).sats).toBe(6);
    expect(momsForLov(livsmedel(), datum('2027-12-31'))).toMatchObject({
      sats: 6,
      valbar: false,
    });
  });

  it('asks instead of guessing once the temporary rate has ended', () => {
    expect(momsForLov(livsmedel(), datum('2028-01-01'))).toMatchObject({ valbar: true });
  });

  it('lets a traveller pick the rate on the ticket', () => {
    expect(momsForLov(lovet('resa'), datum('2026-09-13'))).toMatchObject({
      sats: 6,
      valbar: true,
    });
  });

  it('keeps live animals at 25 % whatever the date', () => {
    expect(momsForLov(lovet('salt-djur'), datum('2026-09-13'))).toEqual({
      sats: 25,
      valbar: false,
    });
  });
});

describe('what a leaf books', () => {
  // 1 250 kr of feed paid privately: 1 000 cost, 250 moms, an insättning.
  it('books feed paid with one’s own money on 4000, 2641 and 2017', () => {
    expect(bokfor('foder', '1250', '2017')).toEqual([
      ['4000', kr('1000')],
      ['2641', kr('250')],
      ['2017', kr('-1250')],
    ]);
  });

  it('books lamb sold into the company account on 3000 and 2611', () => {
    expect(bokfor('salt-djur', '12500', '1930')).toEqual([
      ['1930', kr('12500')],
      ['3000', kr('-10000')],
      ['2611', kr('-2500')],
    ]);
  });

  // 1 060 kr of meat in September 2026: 1 000 plus 6 % on 2631.
  it('books meat at the food rate on 2631', () => {
    expect(bokfor('salt-livsmedel', '1060', '1930')).toEqual([
      ['1930', kr('1060')],
      ['3000', kr('-1000')],
      ['2631', kr('-60')],
    ]);
  });

  it('books a grant without moms', () => {
    expect(bokfor('stod', '8000', '1930')).toEqual([
      ['1930', kr('8000')],
      ['3980', kr('-8000')],
    ]);
  });

  it('books an eget uttag as 2013 against the bank', () => {
    expect(bokfor('eget-uttag', '5000', '1930')).toEqual([
      ['2013', kr('5000')],
      ['1930', kr('-5000')],
    ]);
  });

  it('books F-skatt drawn on the skattekonto as an eget uttag', () => {
    expect(bokfor('f-skatt', '3000', '2012')).toEqual([
      ['2013', kr('3000')],
      ['2012', kr('-3000')],
    ]);
  });

  it('books moms paid from the skattekonto against 2650', () => {
    expect(bokfor('moms-betald', '4200', '2012')).toEqual([
      ['2650', kr('4200')],
      ['2012', kr('-4200')],
    ]);
  });

  it('moves cash from the bank to the till without touching the result', () => {
    expect(bokfor('till-kassan', '500', '1930')).toEqual([
      ['1910', kr('500')],
      ['1930', kr('-500')],
    ]);
  });

  it('books a machine bought for the business as an asset on 1221', () => {
    expect(bokfor('inventarie', '62500', '1930')).toEqual([
      ['1221', kr('50000')],
      ['2641', kr('12500')],
      ['1930', kr('-62500')],
    ]);
  });
});
