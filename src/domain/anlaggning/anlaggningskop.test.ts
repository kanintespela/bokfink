import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import { kontonummer } from '../konto/konto';
import { datum } from '../tid/datum';
import { verifikatserie } from '../verifikat/serie';
import type { BokfortVerifikat } from '../verifikat/verifikat';
import { oregistreradeAnlaggningskop } from './anlaggningskop';

let nummer = 0;

/** A booked verifikat from rows of [konto, kronor]; positive is debet. */
function verifikat(
  rader: readonly (readonly [string, string])[],
  ovrigt: Partial<BokfortVerifikat> = {},
): BokfortVerifikat {
  nummer += 1;
  return {
    status: 'bokfort',
    id: `v-${nummer}` as Uuid,
    serie: verifikatserie('A'),
    nummer,
    datum: datum('2026-11-10'),
    bokfortDatum: datum('2026-11-12'),
    beskrivning: 'Köp',
    konteringar: rader.map(([konto, kronor]) => ({
      konto: kontonummer(konto),
      belopp: oreFromKronor(kronor),
    })),
    kalla: 'manuell',
    ...ovrigt,
  };
}

const inga = new Set<Uuid>();

describe('oregistreradeAnlaggningskop', () => {
  /*
   * A drilled well for 75 000 kr with 25 % moms: the asset is what went to
   * 1150, and the moms is not part of what it cost the firm.
   */
  it('finds a markanläggning by its account, at the amount without moms', () => {
    const brunn = verifikat([
      ['1150', '75000'],
      ['2641', '18750'],
      ['1930', '-93750'],
    ]);

    expect(oregistreradeAnlaggningskop([brunn], inga)).toEqual([
      { verifikat: brunn, slag: 'markanlaggning', belopp: oreFromKronor('75000') },
    ]);
  });

  it.each([
    ['1221', 'inventarie'],
    ['1220', 'inventarie'],
    ['1240', 'inventarie'],
    ['1110', 'byggnad'],
    ['1130', 'mark'],
    ['1150', 'markanlaggning'],
  ])('reads a purchase on %s as %s', (konto, slag) => {
    const kop = verifikat([
      [konto, '40000'],
      ['1930', '-40000'],
    ]);

    expect(oregistreradeAnlaggningskop([kop], inga)[0]?.slag).toBe(slag);
  });

  it('leaves an ordinary cost alone', () => {
    const kostnad = verifikat([
      ['5400', '800'],
      ['2641', '200'],
      ['1930', '-1000'],
    ]);

    expect(oregistreradeAnlaggningskop([kostnad], inga)).toEqual([]);
  });

  /*
   * Neither adds anything to the group. A depreciation takes from it, and
   * the year-end transfer moves this year's purchases from 1221 to 1220
   * within it - suggesting the tractor a second time every new year.
   */
  it('is not fooled by a depreciation or a transfer inside the group', () => {
    const avskrivning = verifikat([
      ['7830', '7500'],
      ['1229', '-7500'],
    ]);
    const omforing = verifikat([
      ['1220', '50000'],
      ['1221', '-50000'],
    ]);

    expect(oregistreradeAnlaggningskop([avskrivning, omforing], inga)).toEqual([]);
  });

  it('leaves out a sale, which takes from the accounts', () => {
    const forsaljning = verifikat([
      ['1930', '26400'],
      ['1222', '-26400'],
    ]);

    expect(oregistreradeAnlaggningskop([forsaljning], inga)).toEqual([]);
  });

  it('leaves out a purchase the register already points at', () => {
    const kop = verifikat([
      ['1221', '50000'],
      ['1930', '-50000'],
    ]);

    expect(oregistreradeAnlaggningskop([kop], new Set([kop.id]))).toEqual([]);
  });

  it('leaves out a purchase the user has said is not an asset', () => {
    const kop = verifikat([
      ['1221', '50000'],
      ['1930', '-50000'],
    ]);

    expect(oregistreradeAnlaggningskop([kop], inga, new Set([kop.id]))).toEqual([]);
  });

  /* An annulled purchase never happened, and its reversal is not one. */
  it('leaves out an annulled purchase and the verifikat that annuls it', () => {
    const kop = verifikat([
      ['1221', '50000'],
      ['1930', '-50000'],
    ]);
    const annullering = verifikat(
      [
        ['1221', '-50000'],
        ['1930', '50000'],
      ],
      { annullerar: kop.id },
    );

    expect(oregistreradeAnlaggningskop([kop, annullering], inga)).toEqual([]);
  });

  it('gives one suggestion for a verifikat with two kinds, the larger one', () => {
    const blandat = verifikat([
      ['1150', '60000'],
      ['1221', '15000'],
      ['1930', '-75000'],
    ]);

    expect(oregistreradeAnlaggningskop([blandat], inga)).toEqual([
      { verifikat: blandat, slag: 'markanlaggning', belopp: oreFromKronor('60000') },
    ]);
  });

  it('adds up several rows of the same kind', () => {
    const tvaRader = verifikat([
      ['1221', '30000'],
      ['1221', '20000'],
      ['1930', '-50000'],
    ]);

    expect(oregistreradeAnlaggningskop([tvaRader], inga)[0]?.belopp).toBe(
      oreFromKronor('50000'),
    );
  });
});
