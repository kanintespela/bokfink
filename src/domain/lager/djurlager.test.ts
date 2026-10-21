import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { oreFromKronor, ore } from '../belopp/ore';
import { uuidv7 } from '../id/uuidv7';
import { datum } from '../tid/datum';
import {
  lagervarde,
  lagervardeForPost,
  skapaDjurlagerinventering,
  vardePerDjur,
  type Djurpost,
} from './djurlager';

const ID = () => uuidv7(1_788_554_000_000, new Uint8Array(10).fill(3));

// SKVFS 2025:27: tackor och baggar lägst 1 100 kr per styck.
const far = (antal: number, nettoforsaljningsvarde: string): Djurpost => ({
  djurslag: 'Får',
  antal,
  genomsnittligProduktionsutgiftPerDjur: oreFromKronor('1100'),
  nettoforsaljningsvardePerDjur: oreFromKronor(nettoforsaljningsvarde),
});

describe('vardePerDjur', () => {
  it('är 85 % av produktionsutgiften när det är lägre än nettoförsäljningsvärdet', () => {
    // 1 100 × 85 % = 935 kr.
    expect(vardePerDjur(far(1, '2000'))).toBe(oreFromKronor('935'));
  });

  it('begränsas av nettoförsäljningsvärdet när det är lägre än 85 %-golvet', () => {
    expect(vardePerDjur(far(1, '500'))).toBe(oreFromKronor('500'));
  });

  it('refuses a negative antal', () => {
    expect(() => vardePerDjur(far(-1, '2000'))).toThrow(RangeError);
  });
});

describe('lagervardeForPost och lagervarde', () => {
  it('multiplicerar värdet per djur med antalet', () => {
    // 15 får × 935 kr = 14 025 kr: antal × värde per djur.
    expect(lagervardeForPost(far(15, '2000'))).toBe(oreFromKronor('14025'));
  });

  it('summerar flera djurslag', () => {
    const inventering = skapaDjurlagerinventering({
      id: ID(),
      datum: datum('2026-12-31'),
      poster: [far(15, '2000'), far(5, '2000')],
    });
    expect(lagervarde(inventering)).toBe(oreFromKronor('18700')); // (15+5) × 935
  });

  it('hanterar en tom inventering som ett lagervärde på noll', () => {
    const tom = skapaDjurlagerinventering({
      id: ID(),
      datum: datum('2026-12-31'),
      poster: [],
    });
    expect(lagervarde(tom)).toBe(oreFromKronor('0'));
  });
});

describe('skapaDjurlagerinventering', () => {
  it('refuses a post utan djurslag', () => {
    expect(() =>
      skapaDjurlagerinventering({
        id: ID(),
        datum: datum('2026-12-31'),
        poster: [{ ...far(1, '2000'), djurslag: '  ' }],
      }),
    ).toThrow(TypeError);
  });
});

describe('invarianter', () => {
  const rimligtBelopp = fc.integer({ min: 0, max: 1_000_000 }).map((v) => ore(v));

  it('värdet per djur överstiger aldrig nettoförsäljningsvärdet', () => {
    fc.assert(
      fc.property(rimligtBelopp, rimligtBelopp, (produktionsutgift, netto) => {
        const post: Djurpost = {
          djurslag: 'Får',
          antal: 1,
          genomsnittligProduktionsutgiftPerDjur: produktionsutgift,
          nettoforsaljningsvardePerDjur: netto,
        };
        expect(vardePerDjur(post)).toBeLessThanOrEqual(netto);
      }),
    );
  });

  it('lagervardeForPost är aldrig negativt', () => {
    fc.assert(
      fc.property(
        rimligtBelopp,
        rimligtBelopp,
        fc.integer({ min: 0, max: 1000 }),
        (produktionsutgift, netto, antal) => {
          const post: Djurpost = {
            djurslag: 'Får',
            antal,
            genomsnittligProduktionsutgiftPerDjur: produktionsutgift,
            nettoforsaljningsvardePerDjur: netto,
          };
          expect(lagervardeForPost(post)).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
