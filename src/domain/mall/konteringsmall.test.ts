import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ore, oreFromKronor, sum } from '../belopp/ore';
import { kontonummer } from '../konto/konto';
import type { Uuid } from '../id/uuidv7';
import {
  delaBelopp,
  delaNetto,
  oresutjamning,
  sokMallar,
  tillampaMall,
  type Konteringsmall,
} from './konteringsmall';

const id = (n: number) => `019b76da-a800-7000-8000-00000000000${n}` as Uuid;

const foder: Konteringsmall = {
  id: id(1),
  namn: 'Inköp av foder',
  sokord: ['kraftfoder', 'hö', 'mineral'],
  riktning: 'utgift',
  konto: kontonummer('4010'),
  momssats: 25,
  momskonto: kontonummer('2640'),
};

const forsaljning: Konteringsmall = {
  id: id(2),
  namn: 'Försäljning av djur',
  sokord: ['lamm', 'får'],
  riktning: 'inkomst',
  konto: kontonummer('3010'),
  momssats: 25,
  momskonto: kontonummer('2610'),
};

const forening: Konteringsmall = {
  id: id(3),
  namn: 'Föreningsavgift',
  sokord: ['medlemsavgift'],
  riktning: 'utgift',
  konto: kontonummer('6981'),
  momssats: 0,
};

describe('delaBelopp', () => {
  /*
   * Worked against a real verifikat. A purchase of feed for 520.31 shows
   * 104.06 VAT and 416.25 net in the books: 52031 x 25 / 125 = 10406.2, which
   * rounds to 10406 öre, and the net is what remains.
   */
  it('splits the amounts the real books split', () => {
    expect(delaBelopp(oreFromKronor('520.31'), 25)).toEqual({
      brutto: oreFromKronor('520.31'),
      netto: oreFromKronor('416.25'),
      moms: oreFromKronor('104.06'),
    });
    expect(delaBelopp(oreFromKronor('1449.00'), 25)).toEqual({
      brutto: oreFromKronor('1449.00'),
      netto: oreFromKronor('1159.20'),
      moms: oreFromKronor('289.80'),
    });
    expect(delaBelopp(oreFromKronor('2599.00'), 25)).toEqual({
      brutto: oreFromKronor('2599.00'),
      netto: oreFromKronor('2079.20'),
      moms: oreFromKronor('519.80'),
    });
  });

  it('leaves an exempt amount whole', () => {
    expect(delaBelopp(oreFromKronor('500.00'), 0)).toEqual({
      brutto: oreFromKronor('500.00'),
      netto: oreFromKronor('500.00'),
      moms: 0,
    });
  });

  it('handles the other Swedish rates', () => {
    expect(delaBelopp(oreFromKronor('112.00'), 12).moms).toBe(oreFromKronor('12.00'));
    expect(delaBelopp(oreFromKronor('106.00'), 6).moms).toBe(oreFromKronor('6.00'));
  });

  it('rounds halves away from zero', () => {
    // 4.50 öre of VAT has to land somewhere, and it lands up.
    expect(delaBelopp(ore(45), 0).moms).toBe(0);
    expect(delaBelopp(ore(9), 25).moms).toBe(ore(2));
    expect(delaBelopp(ore(-9), 25).moms).toBe(ore(-2));
  });

  it('never loses an öre between net and VAT', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50_000_000, max: 50_000_000 }).map(ore),
        fc.constantFrom(0, 6, 12, 25),
        (brutto, sats) => {
          const { netto, moms } = delaBelopp(brutto, sats);
          // The payment line is what actually left the account, so the other
          // two must add up to it exactly.
          expect(sum([netto, moms])).toBe(brutto);
        },
      ),
    );
  });

  it('keeps the VAT within an öre of the exact fraction', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50_000_000 }).map(ore),
        fc.constantFrom(6, 12, 25),
        (brutto, sats) => {
          const exakt = (brutto * sats) / (100 + sats);
          expect(Math.abs(delaBelopp(brutto, sats).moms - exakt)).toBeLessThanOrEqual(
            0.5,
          );
        },
      ),
    );
  });

  it('refuses a rate that is not whole percent', () => {
    expect(() => delaBelopp(ore(100), 12.5)).toThrow(RangeError);
    expect(() => delaBelopp(ore(100), -1)).toThrow(RangeError);
  });
});

describe('tillampaMall', () => {
  it('books an expense the way the real books do', () => {
    const rader = tillampaMall(foder, {
      brutto: oreFromKronor('520.31'),
      betalkonto: kontonummer('2013'),
    });

    // The same verifikat, line for line.
    expect(rader).toEqual([
      { konto: '4010', belopp: oreFromKronor('416.25') },
      { konto: '2640', belopp: oreFromKronor('104.06') },
      { konto: '2013', belopp: oreFromKronor('-520.31') },
    ]);
  });

  it('books income the other way round', () => {
    const rader = tillampaMall(forsaljning, {
      brutto: oreFromKronor('1670.00'),
      betalkonto: kontonummer('1930'),
    });

    expect(rader).toEqual([
      { konto: '1930', belopp: oreFromKronor('1670.00') },
      { konto: '3010', belopp: oreFromKronor('-1336.00') },
      { konto: '2610', belopp: oreFromKronor('-334.00') },
    ]);
  });

  it('leaves out the VAT line when there is no VAT', () => {
    const rader = tillampaMall(forening, {
      brutto: oreFromKronor('400.00'),
      betalkonto: kontonummer('2013'),
    });
    expect(rader).toHaveLength(2);
  });

  it('always produces something that balances', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }).map(ore),
        fc.constantFrom(foder, forsaljning, forening),
        (brutto, mall) => {
          const rader = tillampaMall(mall, { brutto, betalkonto: kontonummer('1930') });
          expect(sum(rader.map((r) => r.belopp))).toBe(0);
        },
      ),
    );
  });

  it('refuses a template with a rate but nowhere to put the VAT', () => {
    const trasig: Konteringsmall = {
      id: id(7),
      namn: foder.namn,
      sokord: foder.sokord,
      riktning: foder.riktning,
      konto: foder.konto,
      momssats: 25,
    };
    expect(() =>
      tillampaMall(trasig, { brutto: ore(100), betalkonto: kontonummer('1930') }),
    ).toThrow(TypeError);
  });
});

describe('sokMallar', () => {
  const alla = [foder, forsaljning, forening];

  it('finds a template by the start of its name', () => {
    expect(sokMallar(alla, 'ink').map((m) => m.namn)).toEqual(['Inköp av foder']);
  });

  it('finds one by a search word', () => {
    expect(sokMallar(alla, 'lamm').map((m) => m.namn)).toEqual(['Försäljning av djur']);
  });

  /*
   * Typing å, ä or ö costs a keystroke on a phone keyboard, and someone
   * standing in a shop will not spend it.
   */
  it('finds Föreningsavgift when someone types forening', () => {
    expect(sokMallar(alla, 'forening').map((m) => m.namn)).toEqual(['Föreningsavgift']);
    expect(sokMallar(alla, 'FORSALJNING').map((m) => m.namn)).toEqual([
      'Försäljning av djur',
    ]);
  });

  it('puts a name match above a search word match', () => {
    const namnet: Konteringsmall = {
      ...forening,
      id: id(4),
      namn: 'Lammbar',
      sokord: [],
    };
    expect(sokMallar([forsaljning, namnet], 'lamm')[0]?.namn).toBe('Lammbar');
  });

  it('breaks a tie on how often each has been used', () => {
    const a: Konteringsmall = { ...foder, id: id(5), namn: 'Foder A', sokord: [] };
    const b: Konteringsmall = { ...foder, id: id(6), namn: 'Foder B', sokord: [] };

    const anvandning = new Map([[b.id, 12]]);
    expect(sokMallar([a, b], 'foder', anvandning).map((m) => m.namn)).toEqual([
      'Foder B',
      'Foder A',
    ]);
  });

  it('returns everything for an empty query', () => {
    expect(sokMallar(alla, '  ')).toHaveLength(3);
  });

  /*
   * With nothing typed, the order is what the person actually books. The list
   * reorders itself as the books change, so the template reached for most
   * often keeps rising to the top without anyone arranging it.
   */
  it('puts the most used first when nothing has been typed', () => {
    const anvandning = new Map([
      [forening.id, 2],
      [forsaljning.id, 9],
    ]);
    expect(sokMallar(alla, '', anvandning).map((m) => m.namn)).toEqual([
      'Försäljning av djur',
      'Föreningsavgift',
      'Inköp av foder',
    ]);
  });

  it('reorders as soon as the counts change', () => {
    const forst = new Map([[foder.id, 1]]);
    const sedan = new Map([
      [foder.id, 1],
      [forening.id, 5],
    ]);
    expect(sokMallar(alla, '', forst)[0]?.namn).toBe('Inköp av foder');
    expect(sokMallar(alla, '', sedan)[0]?.namn).toBe('Föreningsavgift');
  });

  it('falls back to alphabetical order for templates never used', () => {
    expect(sokMallar(alla, '', new Map()).map((m) => m.namn)).toEqual([
      'Föreningsavgift',
      'Försäljning av djur',
      'Inköp av foder',
    ]);
  });

  it('returns nothing when nothing matches', () => {
    expect(sokMallar(alla, 'traktor')).toEqual([]);
  });
});

describe('standardbelopp', () => {
  /*
   * A subscription is booked twelve times a year for the identical figure.
   * Typing it out each time is twelve chances to type it wrong.
   */
  const programvara: Konteringsmall = {
    id: id(8),
    namn: 'Programvara',
    sokord: ['abonnemang'],
    riktning: 'utgift',
    konto: kontonummer('5420'),
    momssats: 25,
    momskonto: kontonummer('2640'),
    standardbelopp: oreFromKronor('249.00'),
  };

  it('is carried on the template without changing how it books', () => {
    expect(programvara.standardbelopp).toBe(oreFromKronor('249.00'));

    // The amount still comes from the caller: the default is a starting point
    // for the form, never something the posting reads behind its back.
    expect(
      tillampaMall(programvara, {
        brutto: oreFromKronor('299.00'),
        betalkonto: kontonummer('1930'),
      }),
    ).toEqual([
      { konto: '5420', belopp: oreFromKronor('239.20') },
      { konto: '2640', belopp: oreFromKronor('59.80') },
      { konto: '1930', belopp: oreFromKronor('-299.00') },
    ]);
  });

  /*
   * Worth being exact about, because real books differ. Splitting 249.00
   * gross gives 199.20 and 49.80. The actual entry reads 199.00 and 49.75,
   * with 0.25 to öresutjämning - because the invoice states 199 kr plus VAT
   * and the payment was rounded to a whole krona.
   *
   * Both are right for their own question. Which one a template should ask is
   * a matter for the momskoder in stage 2, where net-first amounts and
   * öresutjämning belong.
   */
  it('splits its own default from the gross', () => {
    expect(delaBelopp(programvara.standardbelopp!, programvara.momssats)).toEqual({
      brutto: oreFromKronor('249.00'),
      netto: oreFromKronor('199.20'),
      moms: oreFromKronor('49.80'),
    });
  });
});

describe('delaNetto', () => {
  /*
   * The case real books gave: a software subscription invoiced as 199 kr
   * plus VAT. Treating the 249 kr paid as the gross gives 199,20 and 49,80,
   * which is not what the invoice says. Stating the net gives 49,75 and 248,75 - and the 25 öre
   * between that and the payment is the öresutjämning the real entry carries.
   */
  it('splits an invoice stated net of VAT', () => {
    expect(delaNetto(oreFromKronor('199.00'), 25)).toEqual({
      brutto: oreFromKronor('248.75'),
      netto: oreFromKronor('199.00'),
      moms: oreFromKronor('49.75'),
    });
  });

  it('differs from the gross split by exactly what the öresutjämning is', () => {
    const franNetto = delaNetto(oreFromKronor('199.00'), 25);
    const franBrutto = delaBelopp(oreFromKronor('249.00'), 25);

    expect(franBrutto.moms).toBe(oreFromKronor('49.80'));
    expect(franNetto.moms).toBe(oreFromKronor('49.75'));
    expect(oreFromKronor('249.00') - franNetto.brutto).toBe(oreFromKronor('0.25'));
  });

  it('leaves an exempt amount whole', () => {
    expect(delaNetto(oreFromKronor('400.00'), 0)).toEqual({
      brutto: oreFromKronor('400.00'),
      netto: oreFromKronor('400.00'),
      moms: 0,
    });
  });

  it('always adds up', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -50_000_000, max: 50_000_000 }).map(ore),
        fc.constantFrom(0, 6, 12, 25),
        (netto, sats) => {
          const delar = delaNetto(netto, sats);
          expect(sum([delar.netto, delar.moms])).toBe(delar.brutto);
        },
      ),
    );
  });

  it('is what a template asks for when it says so', () => {
    const faktura: Konteringsmall = {
      ...foder,
      id: id(9),
      namn: 'Programvara',
      konto: kontonummer('5420'),
      angesSom: 'netto',
    };

    const rader = tillampaMall(faktura, {
      brutto: oreFromKronor('199.00'),
      betalkonto: kontonummer('1930'),
    });

    expect(rader).toEqual([
      { konto: '5420', belopp: oreFromKronor('199.00') },
      { konto: '2640', belopp: oreFromKronor('49.75') },
      { konto: '1930', belopp: oreFromKronor('-248.75') },
    ]);
  });
});

describe('öresutjämning', () => {
  const programvara: Konteringsmall = {
    id: id(10),
    namn: 'Programvara',
    sokord: [],
    riktning: 'utgift',
    konto: kontonummer('5420'),
    momssats: 25,
    momskonto: kontonummer('2640'),
    angesSom: 'netto',
  };

  /*
   * A monthly subscription, line for line. The invoice states 199 kr plus
   * 49,75 VAT and the charge is a round 249, so 25 öre has to go somewhere -
   * and leaving it out would make the entry disagree with the bank.
   */
  it('reproduces a real entry with a rounding line', () => {
    expect(
      tillampaMall(programvara, {
        brutto: oreFromKronor('199.00'),
        betalkonto: kontonummer('1930'),
        betalat: oreFromKronor('249.00'),
      }),
    ).toEqual([
      { konto: '5420', belopp: oreFromKronor('199.00') },
      { konto: '2640', belopp: oreFromKronor('49.75') },
      { konto: '1930', belopp: oreFromKronor('-249.00') },
      { konto: '3740', belopp: oreFromKronor('0.25') },
    ]);
  });

  it('leaves the line out when nothing was rounded', () => {
    const rader = tillampaMall(programvara, {
      brutto: oreFromKronor('199.00'),
      betalkonto: kontonummer('1930'),
      betalat: oreFromKronor('248.75'),
    });
    expect(rader).toHaveLength(3);
    expect(rader.some((rad) => rad.konto === '3740')).toBe(false);
  });

  it('books a rounding on income the other way round', () => {
    // Lamb sold for 12 645, where the exact figures come to 12 644,91.
    const forsaljning: Konteringsmall = {
      ...programvara,
      id: id(11),
      riktning: 'inkomst',
      konto: kontonummer('3010'),
      momskonto: kontonummer('2610'),
    };

    const rader = tillampaMall(forsaljning, {
      brutto: oreFromKronor('10115.93'),
      betalkonto: kontonummer('1930'),
      betalat: oreFromKronor('12645.00'),
    });

    expect(rader).toEqual([
      { konto: '1930', belopp: oreFromKronor('12645.00') },
      { konto: '3010', belopp: oreFromKronor('-10115.93') },
      { konto: '2610', belopp: oreFromKronor('-2528.98') },
      { konto: '3740', belopp: oreFromKronor('-0.09') },
    ]);
  });

  it('balances however the rounding falls', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 10_000_000 }).map(ore),
        fc.integer({ min: -99, max: 99 }).map(ore),
        fc.constantFrom(programvara, {
          ...programvara,
          id: id(12),
          riktning: 'inkomst' as const,
        }),
        (netto, avvikelse, mall) => {
          const delar = delaNetto(netto, mall.momssats);
          const rader = tillampaMall(mall, {
            brutto: netto,
            betalkonto: kontonummer('1930'),
            betalat: ore(delar.brutto + avvikelse),
          });
          expect(sum(rader.map((rad) => rad.belopp))).toBe(0);
        },
      ),
    );
  });
});

describe('tillampaMall med moms från underlaget', () => {
  /*
   * A real receipt from a shoe shop, 1 004,00 kronor, three pairs on a
   * three-for-two. The shop computes VAT per line and sums, which lands one
   * öre away from 25 % of the total:
   *
   *    399,00 →  79,80     -113,96 → -22,79
   *    499,00 →  99,80     -142,52 → -28,50
   *    499,00 →  99,80     -142,52 → -28,50
   *      6,00 →   1,20
   *                          summa   200,81
   *
   * 25 % of 1 004,00 is 200,80. Both are correctly rounded; they differ in
   * where the rounding falls. What may be deducted is what the seller
   * charged, so the receipt wins and the net takes the remainder.
   */
  it('books the VAT the receipt states, and the net as the remainder', () => {
    const rader = tillampaMall(foder, {
      brutto: oreFromKronor('1004.00'),
      betalkonto: kontonummer('1930'),
      moms: oreFromKronor('200.81'),
    });

    expect(rader).toEqual([
      { konto: kontonummer('4010'), belopp: oreFromKronor('803.19') },
      { konto: kontonummer('2640'), belopp: oreFromKronor('200.81') },
      { konto: kontonummer('1930'), belopp: oreFromKronor('-1004.00') },
    ]);
  });

  it('still balances, whichever figure it used', () => {
    for (const moms of ['200.80', '200.81']) {
      const rader = tillampaMall(foder, {
        brutto: oreFromKronor('1004.00'),
        betalkonto: kontonummer('1930'),
        moms: oreFromKronor(moms),
      });
      const summa = rader.reduce((total, rad) => total + rad.belopp, 0);
      expect(summa).toBe(0);
    }
  });

  it('computes as before when the underlag says nothing', () => {
    const rader = tillampaMall(foder, {
      brutto: oreFromKronor('1004.00'),
      betalkonto: kontonummer('1930'),
    });
    expect(rader[1]?.belopp).toBe(oreFromKronor('200.80'));
  });

  it('credits the VAT on an income instead of debiting it', () => {
    const rader = tillampaMall(forsaljning, {
      brutto: oreFromKronor('1004.00'),
      betalkonto: kontonummer('1930'),
      moms: oreFromKronor('200.81'),
    });
    expect(rader).toEqual([
      { konto: kontonummer('1930'), belopp: oreFromKronor('1004.00') },
      { konto: kontonummer('3010'), belopp: oreFromKronor('-803.19') },
      { konto: kontonummer('2610'), belopp: oreFromKronor('-200.81') },
    ]);
  });

  /*
   * Hard rule 11. A misread that made the VAT larger than the amount would
   * otherwise produce a verifikat that balances and is nonsense.
   */
  it('refuses a VAT that cannot belong to the amount', () => {
    for (const omojlig of ['1004.00', '2000.00', '-10.00']) {
      expect(() =>
        tillampaMall(foder, {
          brutto: oreFromKronor('1004.00'),
          betalkonto: kontonummer('1930'),
          moms: oreFromKronor(omojlig),
        }),
      ).toThrow(RangeError);
    }
  });

  it('ignores a stated VAT on a template that has none', () => {
    const momsfri: Konteringsmall = { ...forening, konto: kontonummer('4010') };
    const rader = tillampaMall(momsfri, {
      brutto: oreFromKronor('1004.00'),
      betalkonto: kontonummer('1930'),
      moms: oreFromKronor('200.81'),
    });
    expect(rader).toEqual([
      { konto: kontonummer('4010'), belopp: oreFromKronor('1004.00') },
      { konto: kontonummer('1930'), belopp: oreFromKronor('-1004.00') },
    ]);
  });
});

/*
 * BAS 3740 Öres- och kronutjämning: what an invoice adds up to before its
 * round total, and the total, differ by the öre it rounded.
 */
describe('oresutjamning', () => {
  const kr = (text: string) => oreFromKronor(text);

  it('is what was paid less netto and moms', () => {
    expect(oresutjamning(kr('249'), kr('199'), kr('49.75'))).toBe(kr('0.25'));
    expect(oresutjamning(kr('211'), kr('169'), kr('42.25'))).toBe(kr('-0.25'));
  });

  it('is nothing when the figures already add up', () => {
    expect(oresutjamning(kr('155.88'), kr('124.70'), kr('31.18'))).toBeUndefined();
  });

  /* A krona or more is a misread or an amount changed by hand. */
  it('is nothing from a krona and up, or without both parts', () => {
    expect(oresutjamning(kr('250'), kr('199'), kr('49.75'))).toBeUndefined();
    expect(oresutjamning(kr('249'), undefined, kr('49.75'))).toBeUndefined();
    expect(oresutjamning(kr('249'), kr('199'), undefined)).toBeUndefined();
  });

  /* The whole entry, as the form builds it from the invoice. */
  it('balances the entry with the rounding on 3740', () => {
    const avrundning = oresutjamning(kr('249'), kr('199'), kr('49.75'))!;
    const rader = tillampaMall(foder, {
      brutto: ore(kr('249') - avrundning),
      betalat: kr('249'),
      moms: kr('49.75'),
      betalkonto: kontonummer('1930'),
    });

    expect(rader).toEqual([
      { konto: '4010', belopp: kr('199') },
      { konto: '2640', belopp: kr('49.75') },
      { konto: '1930', belopp: kr('-249') },
      { konto: '3740', belopp: kr('0.25') },
    ]);
    expect(sum(rader.map((rad) => rad.belopp))).toBe(0);
  });
});
