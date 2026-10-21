import { describe, expect, it } from 'vitest';

import { oreFromKronor, ZERO } from '../belopp/ore';
import { uuidv7 } from '../id/uuidv7';
import { datum } from '../tid/datum';
import {
  avyttra,
  kravsDirektavdrag,
  RedanAvyttradError,
  skapaAnlaggningstillgang,
} from './anlaggningstillgang';

const ID = () => uuidv7(1_788_554_000_000, new Uint8Array(10).fill(1));

const uppgifter = {
  id: ID(),
  benamning: 'Betgrep',
  anskaffningsdatum: datum('2026-01-09'),
  anskaffningsvarde: oreFromKronor('50000'),
  nyttjandeperiod: 10,
};

describe('skapaAnlaggningstillgang', () => {
  it('accepts a well-formed asset', () => {
    const tillgang = skapaAnlaggningstillgang(uppgifter);
    expect(tillgang.benamning).toBe('Betgrep');
    expect(tillgang.avyttring).toBeUndefined();
  });

  it('refuses an empty benämning', () => {
    expect(() => skapaAnlaggningstillgang({ ...uppgifter, benamning: '  ' })).toThrow(
      TypeError,
    );
  });

  it('refuses a zero or negative anskaffningsvärde', () => {
    expect(() =>
      skapaAnlaggningstillgang({ ...uppgifter, anskaffningsvarde: ZERO }),
    ).toThrow(RangeError);
  });

  it('refuses a fractional or non-positive nyttjandeperiod', () => {
    expect(() =>
      skapaAnlaggningstillgang({ ...uppgifter, nyttjandeperiod: 2.5 }),
    ).toThrow(RangeError);
    expect(() => skapaAnlaggningstillgang({ ...uppgifter, nyttjandeperiod: 0 })).toThrow(
      RangeError,
    );
  });
});

describe('kravsDirektavdrag', () => {
  const halvtPrisbasbelopp = oreFromKronor('29400'); // 2025

  it('is required when the value is at or below the threshold', () => {
    expect(kravsDirektavdrag(halvtPrisbasbelopp, 10, halvtPrisbasbelopp)).toBe(true);
    expect(kravsDirektavdrag(oreFromKronor('29399'), 10, halvtPrisbasbelopp)).toBe(true);
  });

  it('is required when the useful life is three years or less, regardless of value', () => {
    expect(kravsDirektavdrag(oreFromKronor('500000'), 3, halvtPrisbasbelopp)).toBe(true);
  });

  it('is not required above the value threshold with a longer useful life', () => {
    expect(kravsDirektavdrag(oreFromKronor('29401'), 4, halvtPrisbasbelopp)).toBe(false);
  });
});

describe('avyttra', () => {
  const tillgang = skapaAnlaggningstillgang(uppgifter);

  it('marks a sale', () => {
    const avyttrad = avyttra(tillgang, {
      datum: datum('2026-06-01'),
      typ: 'forsaljning',
      forsaljningsinkomst: oreFromKronor('37000'),
    });
    expect(avyttrad.avyttring?.forsaljningsinkomst).toBe(oreFromKronor('37000'));
  });

  it('marks an utrangering with no proceeds', () => {
    const utrangerad = avyttra(tillgang, {
      datum: datum('2026-06-01'),
      typ: 'utrangering',
      forsaljningsinkomst: ZERO,
    });
    expect(utrangerad.avyttring?.typ).toBe('utrangering');
  });

  it('refuses an utrangering that claims proceeds', () => {
    expect(() =>
      avyttra(tillgang, {
        datum: datum('2026-06-01'),
        typ: 'utrangering',
        forsaljningsinkomst: oreFromKronor('1'),
      }),
    ).toThrow(RangeError);
  });

  it('refuses avyttring before the asset was acquired', () => {
    expect(() =>
      avyttra(tillgang, {
        datum: datum('2025-01-01'),
        typ: 'forsaljning',
        forsaljningsinkomst: oreFromKronor('1'),
      }),
    ).toThrow(RangeError);
  });

  it('refuses avyttring twice', () => {
    const avyttrad = avyttra(tillgang, {
      datum: datum('2026-06-01'),
      typ: 'utrangering',
      forsaljningsinkomst: ZERO,
    });
    expect(() =>
      avyttra(avyttrad, {
        datum: datum('2026-07-01'),
        typ: 'utrangering',
        forsaljningsinkomst: ZERO,
      }),
    ).toThrow(RedanAvyttradError);
  });
});
