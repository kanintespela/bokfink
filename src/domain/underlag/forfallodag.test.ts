import { describe, expect, it } from 'vitest';

import type { Uuid } from '../id/uuidv7';
import { datum } from '../tid/datum';
import { vantandeFakturor } from './forfallodag';
import { koppla, sattForfallodag, sha256, skapaUnderlag } from './underlag';

const id = (n: number) =>
  `019b76da-a800-7000-8000-${String(n).padStart(12, '0')}` as Uuid;

function faktura(n: number, forfallodag?: string, tillagd = '2026-09-05T08:00:00.000Z') {
  const post = skapaUnderlag({
    id: id(n),
    sha256: sha256(String(n % 10).repeat(64)),
    mime: 'application/pdf',
    storlek: 1000,
    filnamn: `faktura-${n}.pdf`,
    tillagd,
  });
  return forfallodag === undefined ? post : sattForfallodag(post, datum(forfallodag));
}

describe('vantandeFakturor', () => {
  const idag = datum('2026-10-04');

  it('lists the invoices with a due date, the one due first at the top', () => {
    const vantande = vantandeFakturor(
      [faktura(1, '2026-10-30'), faktura(2), faktura(3, '2026-09-30')],
      idag,
    );
    expect(vantande.map((v) => [v.underlag.id, v.forfallodag, v.dagarKvar])).toEqual([
      [id(3), '2026-09-30', -4],
      [id(1), '2026-10-30', 26],
    ]);
  });

  it('counts a due date of today as zero days left', () => {
    expect(vantandeFakturor([faktura(1, '2026-10-04')], idag)[0]?.dagarKvar).toBe(0);
  });

  it('drops an invoice once it is booked as paid', () => {
    const betald = koppla(faktura(1, '2026-10-30'), id(99));
    expect(vantandeFakturor([betald], idag)).toEqual([]);
  });

  it('keeps two invoices due the same day in the order they arrived', () => {
    const vantande = vantandeFakturor(
      [
        faktura(1, '2026-10-30', '2026-09-06T08:00:00.000Z'),
        faktura(2, '2026-10-30', '2026-09-05T08:00:00.000Z'),
      ],
      idag,
    );
    expect(vantande.map((v) => v.underlag.id)).toEqual([id(2), id(1)]);
  });
});
