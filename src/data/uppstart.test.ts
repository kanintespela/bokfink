import { describe, expect, it } from 'vitest';

import { kontonITradet } from '../domain/beslutstrad/beslutstrad';
import type { Handelse } from '../domain/handelse/handelse';
import type { Uuid } from '../domain/id/uuidv7';
import { skapaKonto } from '../domain/konto/konto';
import { arEnbartStartdata, GRUNDKONTON } from './uppstart';

const huvud = (n: number) => ({
  id: `019b76da-a800-7000-8000-${String(n).padStart(12, '0')}` as Uuid,
  enhet: 'nya',
  tidpunkt: '2026-09-13T08:00:00.000Z',
});

const kontoHandelse = (n: number, nummer: string, namn: string): Handelse => ({
  ...huvud(n),
  typ: 'konto.skapat',
  konto: skapaKonto({ nummer, namn }),
});

describe('arEnbartStartdata', () => {
  it('recognises the BAS K1 starter accounts', () => {
    const logg = GRUNDKONTON.map((utkast, index) => ({
      ...huvud(index),
      typ: 'konto.skapat' as const,
      konto: skapaKonto(utkast),
    }));
    expect(arEnbartStartdata(logg)).toBe(true);
  });

  // A device set up before the switch to BAS K1, and never used since.
  it('still recognises the starter accounts earlier versions wrote', () => {
    expect(
      arEnbartStartdata([
        kontoHandelse(1, '1630', 'Avräkning för skatter och avgifter (skattekonto)'),
        kontoHandelse(2, '4010', 'Inköp av material och varor'),
      ]),
    ).toBe(true);
  });

  it('does not take an account someone named themselves for a starter one', () => {
    expect(arEnbartStartdata([kontoHandelse(1, '3000', 'Försäljning av lamm')])).toBe(
      false,
    );
  });
});

describe('GRUNDKONTON', () => {
  // A leaf that books on an account a new ledger lacks cannot be booked at all.
  it('holds every account the booking questions book on', () => {
    const grund = new Set(GRUNDKONTON.map((konto) => konto.nummer));
    expect([...kontonITradet()].filter((konto) => !grund.has(konto))).toEqual([]);
  });
});
