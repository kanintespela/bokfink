import { describe, expect, it } from 'vitest';

import type { Handelse } from '../handelse/handelse';
import { assistentenSenast } from './assistent';

const handelse = (enhet: string, typ: string, tidpunkt: string): Handelse =>
  ({ id: `${enhet}-${tidpunkt}`, enhet, typ, tidpunkt }) as unknown as Handelse;

describe('assistentenSenast', () => {
  it('finds the device that drafts and never books, and when it last did', () => {
    expect(
      assistentenSenast([
        handelse('telefonen', 'verifikat.bokfort', '2026-10-29T08:00:00Z'),
        handelse('telefonen', 'utkast.sparat', '2026-10-29T09:00:00Z'),
        handelse('pi', 'utkast.sparat', '2026-10-28T22:00:00Z'),
        handelse('pi', 'underlag.kopplat', '2026-10-28T22:00:01Z'),
      ]),
    ).toBe('2026-10-28T22:00:01Z');
  });

  /* A phone that saves a draft and books it later is a person, not the assistant. */
  it('finds nothing in books without one', () => {
    expect(
      assistentenSenast([
        handelse('telefonen', 'utkast.sparat', '2026-10-29T08:00:00Z'),
        handelse('telefonen', 'verifikat.bokfort', '2026-10-29T08:01:00Z'),
      ]),
    ).toBeUndefined();
    expect(assistentenSenast([])).toBeUndefined();
  });
});
