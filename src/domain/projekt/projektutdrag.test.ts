import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import { kontonummer } from '../konto/konto';
import { datum } from '../tid/datum';
import { verifikatserie } from '../verifikat/serie';
import {
  annullera,
  bokfor,
  skapaUtkast,
  type BokfortVerifikat,
  type Kontering,
} from '../verifikat/verifikat';
import { skapaProjekt, type Projekt } from './projekt';
import { projektutdrag } from './projektutdrag';

const kr = oreFromKronor;
const LEADER = skapaProjekt({
  id: '019b76da-a800-7000-8000-0000000000a1' as Uuid,
  kod: 'LEADER-28',
  namn: 'Ny scen',
});
const ANNAT = skapaProjekt({
  id: '019b76da-a800-7000-8000-0000000000a2' as Uuid,
  kod: 'FEST-26',
  namn: 'Sommarfest',
});

let nummer = 0;
function bokford(
  datumtext: string,
  beskrivning: string,
  rader: readonly [string, string, Projekt?][],
): BokfortVerifikat {
  nummer += 1;
  const konteringar: Kontering[] = rader.map(([konto, belopp, projekt]) => ({
    konto: kontonummer(konto),
    belopp: kr(belopp),
    ...(projekt === undefined ? {} : { projekt: projekt.id }),
  }));
  return bokfor(
    skapaUtkast({
      id: `019b76da-a800-7000-8000-${String(nummer).padStart(12, '0')}` as Uuid,
      datum: datum(datumtext),
      beskrivning,
      konteringar,
    }),
    {
      serie: verifikatserie('A'),
      nummer,
      bokfortDatum: datum(datumtext),
      kalla: 'manuell',
    },
  );
}

/*
 * A grant of 100 000 kr for LEADER-28, received in 2026 and booked as a skuld on
 * the project (the bank row, as ever, belongs to no project):
 *
 *   2026   received            2900 kredit            100 000
 *          material            5460 debet              30 000
 *          rent                5010 debet              20 000
 *          taken up as income  2900 debet 50 000 / 3710 kredit 50 000
 *   2027   material            5460 debet               5 000
 *
 * Over its whole life the project took in 50 000 and spent 55 000, a result of
 * -5 000, with 100 000 - 50 000 = 50 000 of the grant still a skuld. The other
 * project's 10 000 kr of material is none of this.
 */
const BOKFORING = [
  bokford('2026-03-10', 'Beviljat bidrag', [
    ['1930', '100000'],
    ['2900', '-100000', LEADER],
  ]),
  bokford('2026-05-02', 'Virke', [
    ['5460', '30000', LEADER],
    ['1930', '-30000'],
  ]),
  bokford('2026-06-01', 'Hyra av maskin', [
    ['5010', '20000', LEADER],
    ['1930', '-20000'],
  ]),
  bokford('2026-12-31', 'Bidraget tas upp som intäkt', [
    ['2900', '50000', LEADER],
    ['3710', '-50000', LEADER],
  ]),
  bokford('2027-02-01', 'Spik och skruv', [
    ['5460', '5000', LEADER],
    ['1930', '-5000'],
  ]),
  bokford('2026-07-01', 'Festens material', [
    ['5460', '10000', ANNAT],
    ['1930', '-10000'],
  ]),
];

const summor = (poster: readonly { konto: string; belopp: number }[]) =>
  poster.map((post) => [post.konto, post.belopp]);

describe('projektutdrag', () => {
  it('adds up the whole life of a project, income, cost and what is left of the grant', () => {
    const utdrag = projektutdrag(LEADER, BOKFORING);

    expect(summor(utdrag.intakter)).toEqual([['3710', kr('50000')]]);
    expect(utdrag.summaIntakter).toBe(kr('50000'));
    expect(summor(utdrag.kostnader)).toEqual([
      ['5010', kr('20000')],
      ['5460', kr('35000')],
    ]);
    expect(utdrag.summaKostnader).toBe(kr('55000'));
    expect(utdrag.resultat).toBe(kr('-5000'));
    // The grant not yet taken up: 100 000 received less 50 000 taken up.
    expect(summor(utdrag.skulder)).toEqual([['2900', kr('50000')]]);
    expect(utdrag.summaSkulder).toBe(kr('50000'));
    // The bank rows are on no project, so nothing is left on the asset side.
    expect(utdrag.tillgangar).toEqual([]);
    expect(utdrag.rader).toHaveLength(6);
  });

  it('counts result accounts inside the period and balance accounts up to its end', () => {
    const ar2026 = projektutdrag(LEADER, BOKFORING, {
      start: datum('2026-01-01'),
      slut: datum('2026-12-31'),
    });
    expect(ar2026.summaIntakter).toBe(kr('50000'));
    expect(ar2026.summaKostnader).toBe(kr('50000'));
    expect(ar2026.resultat).toBe(kr('0'));
    expect(ar2026.summaSkulder).toBe(kr('50000'));
    expect(ar2026.rader).toHaveLength(5);

    // 2027 has no income, 5 000 of cost, and the grant is still 50 000 from 2026.
    const ar2027 = projektutdrag(LEADER, BOKFORING, {
      start: datum('2027-01-01'),
      slut: datum('2027-12-31'),
    });
    expect(ar2027.summaIntakter).toBe(kr('0'));
    expect(ar2027.summaKostnader).toBe(kr('5000'));
    expect(ar2027.resultat).toBe(kr('-5000'));
    expect(ar2027.summaSkulder).toBe(kr('50000'));
    expect(ar2027.rader).toHaveLength(1);
  });

  it('shows the grant as it stood at the end of a period, before it was taken up', () => {
    const tidigt = projektutdrag(LEADER, BOKFORING, {
      start: datum('2026-01-01'),
      slut: datum('2026-06-30'),
    });
    expect(tidigt.summaSkulder).toBe(kr('100000'));
    expect(tidigt.summaIntakter).toBe(kr('0'));
    expect(tidigt.summaKostnader).toBe(kr('50000'));
  });

  it('leaves out another project and rows on no project at all', () => {
    const annat = projektutdrag(ANNAT, BOKFORING);
    expect(annat.summaKostnader).toBe(kr('10000'));
    expect(annat.summaIntakter).toBe(kr('0'));
    expect(annat.rader).toHaveLength(1);
  });

  it('lists the rader in the order they happened, with the rad’s own text or the verifikat’s', () => {
    const utdrag = projektutdrag(LEADER, [...BOKFORING].reverse());
    expect(utdrag.rader.map((rad) => rad.datum)).toEqual([
      '2026-03-10',
      '2026-05-02',
      '2026-06-01',
      '2026-12-31',
      '2026-12-31',
      '2027-02-01',
    ]);
    expect(utdrag.rader[0]?.text).toBe('Beviljat bidrag');
  });

  it('takes a reversed verifikat out again, since the reversal carries the project', () => {
    const virke = BOKFORING[1]!;
    const annullering = bokfor(
      annullera(virke, {
        id: '019b76da-a800-7000-8000-0000000000ff' as Uuid,
        datum: datum('2026-05-03'),
      }),
      {
        serie: verifikatserie('A'),
        nummer: 99,
        bokfortDatum: datum('2026-05-03'),
        kalla: 'manuell',
      },
    );

    const utdrag = projektutdrag(LEADER, [...BOKFORING, annullering]);
    // 5460 was 35 000; the reversal removes the first 30 000.
    expect(summor(utdrag.kostnader)).toEqual([
      ['5010', kr('20000')],
      ['5460', kr('5000')],
    ]);
  });

  it('keeps financial items apart, income positive', () => {
    const ranta = bokford('2026-09-01', 'Ränta på bidragskontot', [
      ['1930', '300'],
      ['8310', '-300', LEADER],
    ]);
    const utdrag = projektutdrag(LEADER, [...BOKFORING, ranta]);
    expect(summor(utdrag.finansiella)).toEqual([['8310', kr('300')]]);
    expect(utdrag.resultat).toBe(kr('-4700'));
  });

  it('is empty for a project with nothing booked on it', () => {
    const tomt = projektutdrag(LEADER, []);
    expect(tomt.rader).toEqual([]);
    expect(tomt.resultat).toBe(kr('0'));
    expect(tomt.summaSkulder).toBe(kr('0'));
  });
});
