import { describe, expect, it } from 'vitest';

import { add, oreFromKronor, ZERO } from '../belopp/ore';
import { uuidv7 } from '../id/uuidv7';
import { datum } from '../tid/datum';
import {
  arligAvskrivningsprocent,
  arsAvskrivning,
  avyttraFastighet,
  bokforAvskrivningPaFastighet,
  bokfortVarde,
  ForMycketAvskrivetError,
  forsaljningsresultat,
  RedanAvyttradFastighetError,
  skapaFastighetstillgang,
} from './fastighetstillgang';

const ID = () => uuidv7(1_788_554_000_000, new Uint8Array(10).fill(2));

/*
 * Facit worked out by hand: 64 518,50 × 4 % = 2 580,74 a year, so the book
 * value after one, two and three years is 61 937,76, 59 357,02 and
 * 56 776,28. The same way the collective pool's tests prove themselves
 * against BFN's own worked examples.
 */
describe('en ekonomibyggnad, med handräknat facit', () => {
  const byggnad = skapaFastighetstillgang({
    id: ID(),
    benamning: 'B2 ekonomibyggnad',
    anskaffningsdatum: datum('2012-06-01'),
    anskaffningsvarde: oreFromKronor('64518.50'),
    kategori: { typ: 'byggnad', byggnadstyp: 'ekonomibyggnad_ovrig' },
  });

  it('skrivs av med 4 % om året', () => {
    expect(arligAvskrivningsprocent(byggnad.kategori)).toBe(4);
  });

  it('ger exakt 2 580,74 kr i årlig avskrivning', () => {
    expect(arsAvskrivning(byggnad, ZERO)).toBe(oreFromKronor('2580.74'));
  });

  it('följer tre år i rad: 61 937,76 → 59 357,02 → 56 776,28', () => {
    const ar1 = arsAvskrivning(byggnad, ZERO);
    expect(bokfortVarde(byggnad, ar1)).toBe(oreFromKronor('61937.76'));

    const ar2 = arsAvskrivning(byggnad, ar1);
    const ackEfterAr2 = add(ar1, ar2);
    expect(bokfortVarde(byggnad, ackEfterAr2)).toBe(oreFromKronor('59357.02'));

    const ar3 = arsAvskrivning(byggnad, ackEfterAr2);
    const ackEfterAr3 = add(ackEfterAr2, ar3);
    expect(bokfortVarde(byggnad, ackEfterAr3)).toBe(oreFromKronor('56776.28'));
  });

  it('slutar skriva av när det bokförda värdet når noll, i stället för att gå negativt', () => {
    // After 25 years at 4%, the building is fully written down.
    const heltAvskriven = oreFromKronor('64518.50');
    expect(arsAvskrivning(byggnad, heltAvskriven)).toBe(ZERO);
  });
});

describe('en markanläggning, med handräknat facit', () => {
  const markanlaggning = skapaFastighetstillgang({
    id: ID(),
    benamning: 'Dränering',
    anskaffningsdatum: datum('2012-06-01'),
    anskaffningsvarde: oreFromKronor('27413.75'),
    kategori: { typ: 'markanlaggning', markanlaggningstyp: 'ovrig' },
  });

  it('skrivs av med 5 % om året, avrundat till närmaste öre', () => {
    expect(arligAvskrivningsprocent(markanlaggning.kategori)).toBe(5);
    // 27 413,75 × 5 % = 1 370,6875 → 1 370,69 kr.
    expect(arsAvskrivning(markanlaggning, ZERO)).toBe(oreFromKronor('1370.69'));
  });

  it('täckdike eller skogsväg skrivs av snabbare, 10 %', () => {
    const tackdike = skapaFastighetstillgang({
      id: ID(),
      benamning: 'Täckdike',
      anskaffningsdatum: datum('2020-01-01'),
      anskaffningsvarde: oreFromKronor('10000'),
      kategori: { typ: 'markanlaggning', markanlaggningstyp: 'tackdike_skogsvag' },
    });
    expect(arsAvskrivning(tackdike, ZERO)).toBe(oreFromKronor('1000'));
  });
});

describe('mark och skog', () => {
  it('skrivs aldrig av', () => {
    const mark = skapaFastighetstillgang({
      id: ID(),
      benamning: 'Åkermark',
      anskaffningsdatum: datum('2012-06-01'),
      anskaffningsvarde: oreFromKronor('18400'),
      kategori: { typ: 'mark' },
    });
    const skog = skapaFastighetstillgang({
      id: ID(),
      benamning: 'Skog',
      anskaffningsdatum: datum('2012-06-01'),
      anskaffningsvarde: oreFromKronor('210000'),
      kategori: { typ: 'skog' },
    });

    expect(arsAvskrivning(mark, ZERO)).toBe(ZERO);
    expect(arsAvskrivning(skog, ZERO)).toBe(ZERO);
    expect(bokfortVarde(mark, ZERO)).toBe(oreFromKronor('18400'));
  });
});

describe('forsaljningsresultat', () => {
  it('är vinst när försäljningsinkomsten är högre än bokfört värde', () => {
    expect(forsaljningsresultat(oreFromKronor('50000'), oreFromKronor('60000'))).toBe(
      oreFromKronor('10000'),
    );
  });

  it('är förlust (negativ) när försäljningsinkomsten är lägre', () => {
    expect(forsaljningsresultat(oreFromKronor('50000'), oreFromKronor('30000'))).toBe(
      oreFromKronor('-20000'),
    );
  });
});

describe('registrering med redan ackumulerad avskrivning', () => {
  it('accepterar en tillgång som redan var delvis avskriven vid migrering', () => {
    const byggnad = skapaFastighetstillgang({
      id: ID(),
      benamning: 'B2 ekonomibyggnad',
      anskaffningsdatum: datum('2012-06-01'),
      anskaffningsvarde: oreFromKronor('64518.50'),
      kategori: { typ: 'byggnad', byggnadstyp: 'ekonomibyggnad_ovrig' },
      ackumuleradAvskrivning: oreFromKronor('7742.22'),
    });
    expect(byggnad.ackumuleradAvskrivning).toBe(oreFromKronor('7742.22'));
  });

  it('vägrar en ackumulerad avskrivning utanför anskaffningsvärdet', () => {
    expect(() =>
      skapaFastighetstillgang({
        id: ID(),
        benamning: 'B2 ekonomibyggnad',
        anskaffningsdatum: datum('2012-06-01'),
        anskaffningsvarde: oreFromKronor('64518.50'),
        kategori: { typ: 'byggnad', byggnadstyp: 'ekonomibyggnad_ovrig' },
        ackumuleradAvskrivning: oreFromKronor('64518.51'),
      }),
    ).toThrow(RangeError);
  });
});

describe('bokforAvskrivningPaFastighet', () => {
  const byggnad = skapaFastighetstillgang({
    id: ID(),
    benamning: 'B2 ekonomibyggnad',
    anskaffningsdatum: datum('2012-06-01'),
    anskaffningsvarde: oreFromKronor('64518.50'),
    kategori: { typ: 'byggnad', byggnadstyp: 'ekonomibyggnad_ovrig' },
  });

  it('lägger årets avskrivning till registret', () => {
    const ar1 = arsAvskrivning(byggnad, ZERO);
    const uppdaterad = bokforAvskrivningPaFastighet(byggnad, ar1);
    expect(uppdaterad.ackumuleradAvskrivning).toBe(ar1);

    const ar2 = arsAvskrivning(uppdaterad, uppdaterad.ackumuleradAvskrivning);
    const uppdaterad2 = bokforAvskrivningPaFastighet(uppdaterad, ar2);
    expect(bokfortVarde(byggnad, uppdaterad2.ackumuleradAvskrivning)).toBe(
      oreFromKronor('59357.02'),
    );
  });

  it('vägrar att skriva av mer än vad som återstår', () => {
    const heltAvskriven = bokforAvskrivningPaFastighet(
      byggnad,
      oreFromKronor('64518.50'),
    );
    expect(() => bokforAvskrivningPaFastighet(heltAvskriven, oreFromKronor('1'))).toThrow(
      ForMycketAvskrivetError,
    );
  });
});

describe('avyttraFastighet', () => {
  const tillgang = skapaFastighetstillgang({
    id: ID(),
    benamning: 'Skruvdragare',
    anskaffningsdatum: datum('2020-01-01'),
    anskaffningsvarde: oreFromKronor('10000'),
    kategori: { typ: 'byggnad', byggnadstyp: 'ekonomibyggnad_ovrig' },
  });

  it('markerar en försäljning', () => {
    const avyttrad = avyttraFastighet(tillgang, {
      datum: datum('2026-06-01'),
      typ: 'forsaljning',
      forsaljningsinkomst: oreFromKronor('5000'),
    });
    expect(avyttrad.avyttring?.forsaljningsinkomst).toBe(oreFromKronor('5000'));
  });

  it('refuses avyttring twice', () => {
    const avyttrad = avyttraFastighet(tillgang, {
      datum: datum('2026-06-01'),
      typ: 'utrangering',
      forsaljningsinkomst: ZERO,
    });
    expect(() =>
      avyttraFastighet(avyttrad, {
        datum: datum('2026-07-01'),
        typ: 'utrangering',
        forsaljningsinkomst: ZERO,
      }),
    ).toThrow(RedanAvyttradFastighetError);
  });
});
