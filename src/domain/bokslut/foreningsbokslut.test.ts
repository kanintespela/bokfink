import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { add, oreFromKronor, ZERO, type Ore } from '../belopp/ore';
import { kontonummer, type Kontonummer } from '../konto/konto';
import type { Kontosaldo } from '../rapport/saldon';
import {
  arGiltigtRadval,
  BALANSRADER,
  beraknaForeningsbokslut,
  forvalsradFor,
  harInnehall,
  RADNAMN,
  RESULTATRADER,
  type Foreningsrad,
} from './foreningsbokslut';

const kr = oreFromKronor;

/** A ledger account: what it began the year at and what the year moved. */
function saldo(
  konto: string,
  ingaende: string,
  forandring: string,
): [Kontonummer, Kontosaldo] {
  const k = kontonummer(konto);
  return [
    k,
    {
      konto: k,
      ingaende: kr(ingaende),
      forandring: kr(forandring),
      utgaende: add(kr(ingaende), kr(forandring)),
    },
  ];
}

/*
 * 100 000 kr in the bank and 20 000 kr of inventarier, all of it capital: 120 000 kr.
 * The year: 30 000 in membership fees, 40 000 in a municipal grant, 12 000 for
 * electricity and 3 000 other costs - a surplus of 55 000, all of it in the bank.
 */
const SALDON = new Map([
  saldo('1930', '100000', '55000'),
  saldo('1220', '20000', '0'),
  saldo('2010', '-120000', '0'),
  saldo('3610', '0', '-30000'),
  saldo('3710', '0', '-40000'),
  saldo('5020', '0', '12000'),
  saldo('6390', '0', '3000'),
]);

describe('beraknaForeningsbokslut', () => {
  const bokslut = beraknaForeningsbokslut(SALDON);
  const belopp = (rad: Foreningsrad) => bokslut.rader.get(rad)?.belopp;

  it('sets income up positive and cost negative, as the form prints them', () => {
    expect(belopp('medlemsavgifter')).toBe(kr('30000'));
    expect(belopp('gavor_och_bidrag')).toBe(kr('40000'));
    expect(belopp('ovriga_externa_kostnader')).toBe(kr('-15000'));
    expect(bokslut.summaIntakter).toBe(kr('70000'));
    expect(bokslut.summaKostnader).toBe(kr('-15000'));
    expect(bokslut.verksamhetensResultat).toBe(kr('55000'));
    expect(bokslut.aretsResultat).toBe(kr('55000'));
  });

  it('works eget kapital out as what is owned less what is owed (6.66)', () => {
    expect(bokslut.summaTillgangar).toBe(kr('175000'));
    expect(bokslut.summaSkulder).toBe(ZERO);
    expect(bokslut.summaEgetKapital).toBe(kr('175000'));
    // 175 000 less the 55 000 of this year is what was carried in: 2010's 120 000.
    expect(bokslut.balanseratResultat).toBe(kr('120000'));
    expect(bokslut.summaEgetKapitalOchSkulder).toBe(bokslut.summaTillgangar);
  });

  it('puts debts on the form the right way up', () => {
    const med = beraknaForeningsbokslut(
      new Map([
        saldo('1930', '60000', '0'),
        saldo('2010', '-10000', '0'),
        saldo('2399', '-50000', '0'),
      ]),
    );
    expect(med.rader.get('laneskulder')?.belopp).toBe(kr('50000'));
    expect(med.summaSkulder).toBe(kr('50000'));
    expect(med.summaEgetKapital).toBe(kr('10000'));
    expect(med.summaEgetKapitalOchSkulder).toBe(med.summaTillgangar);
  });

  it('gives the same result before and after the result is moved onto eget kapital', () => {
    const overford = new Map(SALDON);
    for (const [konto, ingaende, forandring] of [
      ['8999', '0', '55000'],
      ['2019', '0', '-55000'],
    ] as const) {
      const [k, s] = saldo(konto, ingaende, forandring);
      overford.set(k, s);
    }
    const efter = beraknaForeningsbokslut(overford);
    expect(efter.aretsResultat).toBe(bokslut.aretsResultat);
    expect(efter.balanseratResultat).toBe(bokslut.balanseratResultat);
    expect(efter.kontonUtanRad).toEqual([]);
  });

  it('reports an account holding a balance that no post takes', () => {
    const med = beraknaForeningsbokslut(
      new Map([...SALDON, saldo('2250', '0', '-1000')]),
    );
    expect(med.kontonUtanRad).toEqual([{ konto: '2250', belopp: kr('-1000') }]);
  });

  it('leaves an account with nothing on it out of the reckoning', () => {
    const med = beraknaForeningsbokslut(new Map([...SALDON, saldo('2250', '0', '0')]));
    expect(med.kontonUtanRad).toEqual([]);
  });

  it('moves an account to another post of the same kind when the association says so', () => {
    const flyttad = beraknaForeningsbokslut(
      SALDON,
      new Map([[kontonummer('5020'), 'verksamhetskostnader' as const]]),
    );
    expect(flyttad.rader.get('verksamhetskostnader')?.belopp).toBe(kr('-12000'));
    expect(flyttad.rader.get('ovriga_externa_kostnader')?.belopp).toBe(kr('-3000'));
    expect(flyttad.aretsResultat).toBe(bokslut.aretsResultat);
  });

  it('ignores a choice that puts a cost account on the balance sheet', () => {
    const ogiltig = beraknaForeningsbokslut(
      SALDON,
      new Map([[kontonummer('5020'), 'kassa_och_bank' as const]]),
    );
    expect(ogiltig.rader.get('ovriga_externa_kostnader')?.belopp).toBe(kr('-15000'));
    expect(ogiltig.rader.has('kassa_och_bank')).toBe(true);
    expect(ogiltig.rader.get('kassa_och_bank')?.belopp).toBe(kr('155000'));
  });

  it('lists the accounts under each post, which is what a note is made from', () => {
    expect(bokslut.rader.get('ovriga_externa_kostnader')?.poster).toEqual([
      { konto: '5020', belopp: kr('-12000') },
      { konto: '6390', belopp: kr('-3000') },
    ]);
  });

  it('always balances: eget kapital and skulder are as large as tillgångar', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.constantFrom('1930', '1220', '1510', '2399', '2440', '2900', '2010'),
            fc.integer({ min: -5_000_000, max: 5_000_000 }),
          ),
          { maxLength: 10 },
        ),
        fc.array(
          fc.tuple(
            fc.constantFrom('3610', '3710', '3811', '5020', '6390', '8300', '8400'),
            fc.integer({ min: -2_000_000, max: 2_000_000 }),
          ),
          { maxLength: 10 },
        ),
        (balans, resultat) => {
          const karta = new Map<Kontonummer, Kontosaldo>();
          for (const [konto, ore] of balans) {
            const k = kontonummer(konto);
            const redan = karta.get(k)?.utgaende ?? ZERO;
            const nytt = add(redan, ore as unknown as Ore);
            karta.set(k, { konto: k, ingaende: nytt, forandring: ZERO, utgaende: nytt });
          }
          for (const [konto, ore] of resultat) {
            const k = kontonummer(konto);
            const redan = karta.get(k)?.forandring ?? ZERO;
            const nytt = add(redan, ore as unknown as Ore);
            karta.set(k, { konto: k, ingaende: ZERO, forandring: nytt, utgaende: nytt });
          }
          const resultatet = beraknaForeningsbokslut(karta);
          return (
            resultatet.summaEgetKapitalOchSkulder === resultatet.summaTillgangar &&
            resultatet.kontonUtanRad.length === 0
          );
        },
      ),
    );
  });
});

describe('forvalsradFor', () => {
  it('places the starter accounts where bilaga 2 would have them', () => {
    const rad = (konto: string) => forvalsradFor(kontonummer(konto));
    expect(rad('3610')).toBe('medlemsavgifter');
    expect(rad('3710')).toBe('gavor_och_bidrag');
    expect(rad('3720')).toBe('gavor_och_bidrag');
    expect(rad('3811')).toBe('ovriga_verksamhetsintakter');
    expect(rad('3320')).toBe('forsaljningsintakter');
    expect(rad('3740')).toBe('ovriga_verksamhetsintakter');
    expect(rad('4010')).toBe('forsaljningskostnader');
    expect(rad('5020')).toBe('ovriga_externa_kostnader');
    expect(rad('7830')).toBe('av_och_nedskrivningar');
    expect(rad('8300')).toBe('finansiella_intakter');
    expect(rad('8400')).toBe('finansiella_kostnader');
    expect(rad('1930')).toBe('kassa_och_bank');
    expect(rad('1940')).toBe('kassa_och_bank');
    expect(rad('2399')).toBe('laneskulder');
    expect(rad('2900')).toBe('ovriga_skulder');
  });

  it('keeps eget kapital and the transfer of the result out of every post', () => {
    expect(forvalsradFor(kontonummer('2010'))).toBe('eget_kapital');
    expect(forvalsradFor(kontonummer('2030'))).toBe('eget_kapital');
    expect(forvalsradFor(kontonummer('8999'))).toBe('resultatoverforing');
  });

  it('has no place for an avsättning, which an association does not make (6.68)', () => {
    expect(forvalsradFor(kontonummer('2250'))).toBeUndefined();
  });
});

describe('arGiltigtRadval', () => {
  it('allows a result account only a result post, and a balance account only a balance post', () => {
    expect(arGiltigtRadval(kontonummer('5020'), 'verksamhetskostnader')).toBe(true);
    expect(arGiltigtRadval(kontonummer('5020'), 'kassa_och_bank')).toBe(false);
    expect(arGiltigtRadval(kontonummer('1930'), 'inventarier')).toBe(true);
    expect(arGiltigtRadval(kontonummer('1930'), 'skatt')).toBe(false);
  });

  it('moves neither the capital accounts nor the transfer', () => {
    expect(arGiltigtRadval(kontonummer('2010'), 'ovriga_skulder')).toBe(false);
    expect(arGiltigtRadval(kontonummer('8999'), 'skatt')).toBe(false);
  });
});

describe('harInnehall', () => {
  it('keeps a post that has an amount in either year, since comparatives go with every post shown', () => {
    const aret = beraknaForeningsbokslut(SALDON);
    const foregaende = beraknaForeningsbokslut(new Map([saldo('3720', '0', '-5000')]));
    expect(harInnehall('medlemsavgifter', aret, undefined)).toBe(true);
    expect(harInnehall('gavor_och_bidrag', aret, foregaende)).toBe(true);
    expect(harInnehall('forsaljningsintakter', aret, foregaende)).toBe(false);
  });
});

describe('uppställningen', () => {
  it('names every post as bilaga 2 prints it and has none more', () => {
    expect(RESULTATRADER).toHaveLength(15);
    expect(BALANSRADER).toHaveLength(13);
    expect(RADNAMN.av_och_nedskrivningar).toBe(
      'Av- och nedskrivningar av materiella och immateriella anläggningstillgångar',
    );
    expect(RADNAMN.gavor_och_bidrag).toBe('Gåvor och bidrag');
  });
});
