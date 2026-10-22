import { describe, expect, it } from 'vitest';

import type { Uuid } from '../id/uuidv7';
import { rakenskapsarsid, skapaRakenskapsar } from '../rakenskapsar/rakenskapsar';
import { datum } from '../tid/datum';
import {
  koppla,
  sattForfallodag,
  sattText,
  sha256,
  skapaUnderlag,
} from '../underlag/underlag';
import { paminnelser } from './paminnelser';

const id = (n: number) =>
  `019b76da-a800-7000-8000-${String(n).padStart(12, '0')}` as Uuid;

function ar(start: string, momslastTom?: string, avslutat = false) {
  const fran = datum(start);
  return skapaRakenskapsar({
    id: rakenskapsarsid(fran),
    start: fran,
    slut: datum(`${start.slice(0, 4)}-12-31`),
    avslutat,
    ...(momslastTom === undefined ? {} : { momslastTom: datum(momslastTom) }),
  });
}

function faktura(n: number, forfallodag: string, text?: string) {
  const post = sattForfallodag(
    skapaUnderlag({
      id: id(n),
      sha256: sha256(String(n).repeat(64)),
      mime: 'application/pdf',
      storlek: 1000,
      filnamn: `faktura-${n}.pdf`,
      tillagd: '2026-09-05T08:00:00.000Z',
    }),
    datum(forfallodag),
  );
  return text === undefined ? post : sattText(post, text);
}

describe('paminnelser', () => {
  it('lists every date ahead, soonest first', () => {
    const poster = paminnelser({
      rakenskapsar: [
        ar('2025-01-01', '2025-12-31', true),
        ar('2026-01-01', '2026-06-30'),
      ],
      momsperiod: 'kvartal',
      underlag: [
        faktura(1, '2026-10-20', 'Lantbrukstjänst i Ekeby AB\nFörfallodatum 2026-10-20'),
        faktura(2, '2026-09-30'),
        koppla(faktura(3, '2026-11-01'), id(99)),
      ],
      idag: datum('2026-10-04'),
    });

    expect(poster.map((post) => [post.datum, post.uid, post.rubrik])).toEqual([
      [
        '2026-10-20',
        `faktura-${id(1)}@kontera`,
        'Betala faktura från Lantbrukstjänst i Ekeby AB',
      ],
      ['2026-11-12', 'moms-2026-07-01@kontera', 'Momsdeklaration 2026 kv 3'],
      ['2027-02-12', 'moms-2026-10-01@kontera', 'Momsdeklaration 2026 kv 4'],
      ['2027-05-03', 'inkomstdeklaration-2026@kontera', 'Inkomstdeklaration 2026'],
    ]);
  });

  it('keeps the inkomstdeklaration of a closed year until its day has passed', () => {
    const poster = paminnelser({
      rakenskapsar: [ar('2025-01-01', '2025-12-31', true)],
      momsperiod: 'kvartal',
      underlag: [],
      idag: datum('2026-05-04'),
    });
    expect(poster.map((post) => post.uid)).toEqual(['inkomstdeklaration-2025@kontera']);
  });

  it('names an invoice without a readable supplier plainly', () => {
    const [post] = paminnelser({
      rakenskapsar: [],
      momsperiod: 'kvartal',
      underlag: [faktura(2, '2026-10-30')],
      idag: datum('2026-10-04'),
    });
    expect(post?.rubrik).toBe('Betala faktura');
    expect(post?.beskrivning).toContain('faktura-2.pdf');
  });
});
