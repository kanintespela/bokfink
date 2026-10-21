import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import {
  farProduktionsutgift,
  OkantProduktionsutgiftsarError,
} from './djurproduktionsutgift';

describe('farProduktionsutgift', () => {
  it('ger 2025 års siffror från SKVFS 2025:27', () => {
    const rad = farProduktionsutgift(2025);
    expect(rad.tackaEllerBagge).toBe(oreFromKronor('1100'));
    expect(rad.lammPerKg).toBe(oreFromKronor('20.20'));
  });

  it('refuses a year that has not been entered rather than guessing', () => {
    expect(() => farProduktionsutgift(2026)).toThrow(OkantProduktionsutgiftsarError);
    expect(() => farProduktionsutgift(2023)).toThrow(OkantProduktionsutgiftsarError);
  });
});
