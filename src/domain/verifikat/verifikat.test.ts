import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ore, oreFromKronor, type Ore } from '../belopp/ore';
import { kontonummer } from '../konto/konto';
import { datum } from '../tid/datum';
import type { Uuid } from '../id/uuidv7';
import { granskaSerie, verifikatserie } from './serie';
import {
  annullera,
  arAnnullering,
  arBalanserat,
  arDebet,
  arKredit,
  balans,
  beteckning,
  bokfor,
  ObalanseratVerifikatError,
  omslutning,
  ratta,
  skapaUtkast,
  TomRattelseError,
  type Kontering,
} from './verifikat';

const ID = '019b76da-a800-7000-8000-000000000000' as Uuid;

const rad = (konto: string, kronor: string): Kontering => ({
  konto: kontonummer(konto),
  belopp: oreFromKronor(kronor),
});

const arbBelopp = fc.integer({ min: -10_000_000, max: 10_000_000 }).map(ore);
const arbKonto = fc.integer({ min: 1000, max: 8999 }).map((n) => kontonummer(String(n)));

/** Lines that always balance: the last one cancels everything before it. */
const arbBalanserade = fc
  .array(fc.tuple(arbKonto, arbBelopp), { minLength: 1, maxLength: 20 })
  .chain((rader) => {
    const differens = rader.reduce((total, [, belopp]) => total + belopp, 0);
    return arbKonto.map((konto): Kontering[] => [
      ...rader.map(([k, belopp]) => ({ konto: k, belopp })),
      { konto, belopp: ore(-differens) },
    ]);
  });

describe('balans', () => {
  it('is zero for a verifikat that balances', () => {
    // Inköp av mineralfoder paid from the owner's own money.
    const konteringar = [
      rad('2013', '-520.31'),
      rad('2640', '104.06'),
      rad('4010', '416.25'),
    ];
    expect(balans(konteringar)).toBe(0);
    expect(arBalanserat(konteringar)).toBe(true);
  });

  it('reports how far off an unbalanced verifikat is', () => {
    expect(balans([rad('1930', '100.00'), rad('3010', '-99.50')])).toBe(
      oreFromKronor('0.50'),
    );
  });

  it('is always zero for anything skapaUtkast accepted', () => {
    fc.assert(
      fc.property(arbBalanserade, (konteringar) => {
        const utkast = skapaUtkast({
          id: ID,
          datum: datum('2026-09-05'),
          beskrivning: 'test',
          konteringar,
        });
        expect(balans(utkast.konteringar)).toBe(0);
      }),
    );
  });
});

describe('debet and kredit', () => {
  it('reads the sign', () => {
    expect(arDebet(rad('4010', '416.25'))).toBe(true);
    expect(arKredit(rad('4010', '416.25'))).toBe(false);
    expect(arKredit(rad('2013', '-520.31'))).toBe(true);
    expect(arDebet(rad('2013', '-520.31'))).toBe(false);
  });

  it('calls a zero line neither', () => {
    const noll = rad('2013', '0.00');
    expect(arDebet(noll)).toBe(false);
    expect(arKredit(noll)).toBe(false);
  });
});

describe('skapaUtkast', () => {
  /*
   * Why the receipt watcher chose the accounts, for the person reviewing the
   * draft. It belongs to the suggestion and stays there: a booked verifikat
   * says what happened, not what a reader thought of the receipt.
   */
  it('keeps the reasons on the draft and leaves them out of the booking', () => {
    const forslag = skapaUtkast({
      id: ID,
      datum: datum('2026-09-05'),
      beskrivning: 'Diesel',
      konteringar: [rad('5400', '100.00'), rad('2013', '-100.00')],
      motivering: '  Som de senaste dieselköpen.  ',
    });
    expect(forslag.motivering).toBe('Som de senaste dieselköpen.');

    const bokfort = bokfor(forslag, {
      serie: verifikatserie('A'),
      nummer: 1,
      bokfortDatum: datum('2026-09-05'),
      kalla: 'manuell',
    });
    expect('motivering' in bokfort).toBe(false);
  });

  it('refuses a verifikat that does not balance', () => {
    expect(() =>
      skapaUtkast({
        id: ID,
        datum: datum('2026-09-05'),
        beskrivning: 'Saknar femtio öre',
        konteringar: [rad('1930', '100.00'), rad('3010', '-99.50')],
      }),
    ).toThrow(ObalanseratVerifikatError);
  });

  it('names the difference in kronor, not in öre', () => {
    try {
      skapaUtkast({
        id: ID,
        datum: datum('2026-09-05'),
        beskrivning: 'Fel',
        konteringar: [rad('1930', '1234.56'), rad('3010', '-1000.00')],
      });
      expect.unreachable('skulle ha kastat');
    } catch (cause) {
      expect(cause).toBeInstanceOf(ObalanseratVerifikatError);
      expect((cause as Error).message).toContain('234,56 kr');
    }
  });

  it('refuses fewer than two lines', () => {
    expect(() =>
      skapaUtkast({
        id: ID,
        datum: datum('2026-09-05'),
        beskrivning: 'Ensam rad',
        konteringar: [rad('1930', '0.00')],
      }),
    ).toThrow(TypeError);
  });

  /*
   * The three shapes below all occur in real SIE exports. None of them is
   * tidy, and all of them have to import without complaint, because history
   * has to be readable as it stands.
   */
  it('accepts several lines on the same account', () => {
    // A year-end entry, two depreciation lines on 7830 against two on 1229.
    const utkast = skapaUtkast({
      id: ID,
      datum: datum('2025-12-31'),
      beskrivning: 'avskrivningar inventarier',
      konteringar: [
        rad('7830', '6400.00'),
        rad('7830', '5800.00'),
        rad('1229', '-6400.00'),
        rad('1229', '-5800.00'),
      ],
    });
    expect(utkast.konteringar).toHaveLength(4);
  });

  it('accepts a line with a zero amount', () => {
    // An eget uttag that kept a stray empty line.
    const utkast = skapaUtkast({
      id: ID,
      datum: datum('2025-12-14'),
      beskrivning: 'Eget uttag',
      konteringar: [rad('2013', '0.00'), rad('1930', '-2500.00'), rad('2013', '2500.00')],
    });
    expect(utkast.konteringar).toHaveLength(3);
  });

  it('accepts an empty beskrivning', () => {
    // Imported books can have none. The registration form asks for one; the
    // importer
    // cannot demand it retroactively.
    const utkast = skapaUtkast({
      id: ID,
      datum: datum('2024-01-13'),
      beskrivning: '',
      konteringar: [rad('5460', '551.20'), rad('2641', '137.80'), rad('2013', '-689.00')],
    });
    expect(utkast.beskrivning).toBe('');
  });

  it('trims the beskrivning', () => {
    const utkast = skapaUtkast({
      id: ID,
      datum: datum('2026-09-05'),
      beskrivning: '  Inköp av kraftfoder  ',
      konteringar: [rad('4010', '239.20'), rad('2013', '-239.20')],
    });
    expect(utkast.beskrivning).toBe('Inköp av kraftfoder');
  });

  it('copies the lines so the caller cannot change them afterwards', () => {
    const konteringar = [rad('4010', '239.20'), rad('2013', '-239.20')];
    const utkast = skapaUtkast({
      id: ID,
      datum: datum('2026-09-05'),
      beskrivning: 'Inköp',
      konteringar,
    });

    (konteringar[0] as { belopp: Ore }).belopp = ore(999);

    expect(utkast.konteringar[0]?.belopp).toBe(oreFromKronor('239.20'));
    expect(arBalanserat(utkast.konteringar)).toBe(true);
  });
});

describe('bokfor', () => {
  const utkast = (datumtext: string, beskrivning = 'Inköp av kraftfoder') =>
    skapaUtkast({
      id: ID,
      datum: datum(datumtext),
      beskrivning,
      konteringar: [rad('4010', '239.20'), rad('2013', '-239.20')],
    });

  const uppgifter = (nummer: number, bokfortDatum: string) => ({
    serie: verifikatserie('A'),
    nummer,
    bokfortDatum: datum(bokfortDatum),
    kalla: 'manuell' as const,
  });

  it('stamps the series, the number and the day it was recorded', () => {
    const bokfort = bokfor(utkast('2026-01-09'), uppgifter(2, '2026-01-12'));

    expect(bokfort.status).toBe('bokfort');
    expect(beteckning(bokfort)).toBe('A2');
    expect(bokfort.datum).toBe('2026-01-09');
    expect(bokfort.bokfortDatum).toBe('2026-01-12');
    expect(bokfort.kalla).toBe('manuell');
    expect(bokfort.id).toBe(utkast('2026-01-09').id);
  });

  /*
   * The finding that shaped this: numbers follow the order things were
   * booked, never the dates they happened on. Real books do it all the time -
   * number 4 dated 2026-01-16 and number 5 dated 2026-01-08 - so a later
   * number with an earlier date is the normal case.
   */
  it('accepts a verifikat dated before the one numbered ahead of it', () => {
    const a4 = bokfor(
      utkast('2026-01-16', 'Programvara januari'),
      uppgifter(4, '2026-01-16'),
    );
    const a5 = bokfor(utkast('2026-01-08', 'Foderanalys'), uppgifter(5, '2026-01-22'));

    expect(a5.nummer).toBeGreaterThan(a4.nummer);
    expect(a5.datum < a4.datum).toBe(true);
  });

  it('keeps numbering when a whole run is entered backwards in time', () => {
    const datumen = ['2026-03-19', '2026-02-16', '2026-01-08'];
    const bokforda = datumen.map((d, i) =>
      bokfor(utkast(d), uppgifter(i + 1, '2026-03-20')),
    );

    expect(bokforda.map((v) => v.nummer)).toEqual([1, 2, 3]);
    expect(granskaSerie(bokforda.map((v) => v.nummer)).obruten).toBe(true);
  });

  it('refuses a number that is not a positive whole number', () => {
    expect(() => bokfor(utkast('2026-01-09'), uppgifter(0, '2026-01-09'))).toThrow(
      TypeError,
    );
    expect(() => bokfor(utkast('2026-01-09'), uppgifter(1.5, '2026-01-09'))).toThrow(
      TypeError,
    );
  });

  it('checks the balance again at the last gate before it is permanent', () => {
    const manipulerat = {
      ...utkast('2026-01-09'),
      konteringar: [rad('4010', '239.20'), rad('2013', '-100.00')],
    };
    expect(() => bokfor(manipulerat, uppgifter(1, '2026-01-09'))).toThrow(
      ObalanseratVerifikatError,
    );
  });

  it('copies the lines rather than sharing them with the draft', () => {
    const original = utkast('2026-01-09');
    const bokfort = bokfor(original, uppgifter(1, '2026-01-09'));
    expect(bokfort.konteringar).not.toBe(original.konteringar);
    expect(bokfort.konteringar).toEqual(original.konteringar);
  });
});

describe('immutability of a booked verifikat', () => {
  const bokfort = () =>
    bokfor(
      skapaUtkast({
        id: ID,
        datum: datum('2026-01-09'),
        beskrivning: 'Inköp av mineralfoder',
        konteringar: [
          rad('2013', '-520.31'),
          rad('2640', '104.06'),
          rad('4010', '416.25'),
        ],
      }),
      {
        serie: verifikatserie('A'),
        nummer: 2,
        bokfortDatum: datum('2026-01-12'),
        kalla: 'manuell',
      },
    );

  /*
   * Hard rule 5. Modules are strict, so writing to a frozen property throws
   * rather than failing silently - which is the whole point: code that tries
   * to edit the books stops where it stands.
   */
  it('throws when a field is reassigned', () => {
    const v = bokfort();
    expect(() => {
      (v as { nummer: number }).nummer = 99;
    }).toThrow(TypeError);
    expect(v.nummer).toBe(2);
  });

  it('throws when a line amount is reassigned', () => {
    const v = bokfort();
    expect(() => {
      (v.konteringar[0] as { belopp: Ore }).belopp = ore(1);
    }).toThrow(TypeError);
    expect(v.konteringar[0]?.belopp).toBe(oreFromKronor('-520.31'));
  });

  it('throws when a line is added or removed', () => {
    const v = bokfort();
    expect(() => (v.konteringar as Kontering[]).push(rad('1930', '0.00'))).toThrow(
      TypeError,
    );
    expect(v.konteringar).toHaveLength(3);
  });

  it('leaves a draft editable, which is what makes the rule bearable', () => {
    const utkast = skapaUtkast({
      id: ID,
      datum: datum('2026-01-09'),
      beskrivning: 'Utkast',
      konteringar: [rad('4010', '100.00'), rad('2013', '-100.00')],
    });
    expect(Object.isFrozen(utkast)).toBe(false);
  });
});

describe('annullera', () => {
  const original = () =>
    bokfor(
      skapaUtkast({
        id: ID,
        datum: datum('2026-01-09'),
        beskrivning: 'Inköp av mineralfoder',
        konteringar: [
          rad('2013', '-520.31'),
          rad('2640', '104.06'),
          rad('4010', '416.25'),
        ],
      }),
      {
        serie: verifikatserie('A'),
        nummer: 2,
        bokfortDatum: datum('2026-01-12'),
        kalla: 'manuell',
      },
    );

  const ANNULLERINGS_ID = '019b76da-a800-7000-8000-000000000001' as Uuid;

  it('mirrors every line and points back at the original', () => {
    const a = annullera(original(), {
      id: ANNULLERINGS_ID,
      datum: datum('2026-02-01'),
    });

    expect(a.konteringar.map((r) => r.belopp)).toEqual([
      oreFromKronor('520.31'),
      oreFromKronor('-104.06'),
      oreFromKronor('-416.25'),
    ]);
    expect(a.annullerar).toBe(ID);
    expect(arBalanserat(a.konteringar)).toBe(true);
  });

  it('nets to nothing on every account it touched', () => {
    const o = original();
    const a = annullera(o, { id: ANNULLERINGS_ID, datum: datum('2026-02-01') });

    const perKonto = new Map<string, number>();
    for (const r of [...o.konteringar, ...a.konteringar]) {
      perKonto.set(r.konto, (perKonto.get(r.konto) ?? 0) + r.belopp);
    }
    for (const [konto, saldo] of perKonto) {
      expect(saldo, `konto ${konto}`).toBe(0);
    }
  });

  it('describes itself in terms of what it undid', () => {
    const a = annullera(original(), {
      id: ANNULLERINGS_ID,
      datum: datum('2026-02-01'),
    });
    expect(a.beskrivning).toBe('Annullering av A2: Inköp av mineralfoder');
  });

  it('takes a description when one is given', () => {
    const a = annullera(original(), {
      id: ANNULLERINGS_ID,
      datum: datum('2026-02-01'),
      beskrivning: 'Fel leverantör',
    });
    expect(a.beskrivning).toBe('Fel leverantör');
  });

  it('is booked through the same gate as anything else', () => {
    const a = bokfor(
      annullera(original(), { id: ANNULLERINGS_ID, datum: datum('2026-02-01') }),
      {
        serie: verifikatserie('A'),
        nummer: 35,
        bokfortDatum: datum('2026-02-01'),
        kalla: 'manuell',
      },
    );
    expect(beteckning(a)).toBe('A35');
    expect(arAnnullering(a)).toBe(true);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('refuses to annul an annulment', () => {
    const a = bokfor(
      annullera(original(), { id: ANNULLERINGS_ID, datum: datum('2026-02-01') }),
      {
        serie: verifikatserie('A'),
        nummer: 35,
        bokfortDatum: datum('2026-02-01'),
        kalla: 'manuell',
      },
    );
    expect(() => annullera(a, { id: ID, datum: datum('2026-02-02') })).toThrow(TypeError);
  });

  it('reverses any balanced verifikat exactly', () => {
    fc.assert(
      fc.property(arbBalanserade, (konteringar) => {
        const o = bokfor(
          skapaUtkast({
            id: ID,
            datum: datum('2026-01-09'),
            beskrivning: 'test',
            konteringar,
          }),
          {
            serie: verifikatserie('A'),
            nummer: 1,
            bokfortDatum: datum('2026-01-09'),
            kalla: 'manuell',
          },
        );
        const a = annullera(o, { id: ANNULLERINGS_ID, datum: datum('2026-01-09') });

        expect(arBalanserat(a.konteringar)).toBe(true);
        expect(balans([...o.konteringar, ...a.konteringar])).toBe(0);
      }),
    );
  });
});

describe('omslutning', () => {
  it('is the total of the debit side', () => {
    // A feed purchase: 416.25 to 4010 and 104.06 to 2640, against 520.31 credited.
    const utkast = skapaUtkast({
      id: ID,
      datum: datum('2026-01-09'),
      beskrivning: 'Inköp av mineralfoder',
      konteringar: [rad('2013', '-520.31'), rad('2640', '104.06'), rad('4010', '416.25')],
    });
    expect(omslutning(utkast)).toBe(oreFromKronor('520.31'));
  });

  it('equals the credit side, since the two always balance', () => {
    fc.assert(
      fc.property(arbBalanserade, (konteringar) => {
        const utkast = skapaUtkast({
          id: ID,
          datum: datum('2026-01-09'),
          beskrivning: 'test',
          konteringar,
        });
        const kredit = konteringar
          .filter((r) => r.belopp < 0)
          .reduce((s, r) => s - r.belopp, 0);
        expect(omslutning(utkast)).toBe(kredit);
      }),
    );
  });
});

describe('ratta', () => {
  const bokfort = (beskrivning = 'svecol', datumtext = '2026-09-16') =>
    bokfor(
      skapaUtkast({
        id: ID,
        datum: datum(datumtext),
        beskrivning,
        konteringar: [
          rad('5400', '2580.00'),
          rad('2641', '645.00'),
          rad('2017', '-3225.00'),
        ],
      }),
      {
        serie: verifikatserie('A'),
        nummer: 7,
        bokfortDatum: datum('2026-09-16'),
        kalla: 'manuell' as const,
      },
    );

  const nar = '2026-09-17T09:15:00.000Z';
  const enhet = 'telefonen';

  it('corrects the description and keeps the old one beside it', () => {
    const rattat = ratta(bokfort(), { beskrivning: 'Swedol AB', nar, enhet });

    expect(rattat.beskrivning).toBe('Swedol AB');
    // BFL 5 kap. 8 §: when, and by whom.
    expect(rattat.rattelser).toEqual([
      { nar, enhet, falt: 'beskrivning', fran: 'svecol', till: 'Swedol AB' },
    ]);
  });

  it('corrects the date', () => {
    const rattat = ratta(bokfort(), { datum: datum('2026-09-11'), nar, enhet });

    expect(rattat.datum).toBe('2026-09-11');
    expect(rattat.rattelser?.[0]).toMatchObject({ falt: 'datum', fran: '2026-09-16' });
  });

  /*
   * The whole reason corrections are allowed at all. Nothing that decides
   * what the books say happened may move, whatever is passed in.
   */
  it('never touches the money, the series or the number', () => {
    const original = bokfort();
    const rattat = ratta(original, {
      beskrivning: 'Swedol AB',
      datum: datum('2026-09-11'),
      nar,
      enhet,
    });

    expect(rattat.konteringar).toEqual(original.konteringar);
    expect(rattat.serie).toBe(original.serie);
    expect(rattat.nummer).toBe(original.nummer);
    expect(rattat.id).toBe(original.id);
    expect(rattat.bokfortDatum).toBe(original.bokfortDatum);
  });

  it('stacks corrections oldest first', () => {
    const en = ratta(bokfort(), { beskrivning: 'Swedol', nar, enhet });
    const tva = ratta(en, {
      beskrivning: 'Swedol AB',
      nar: '2026-09-18T07:00:00.000Z',
      enhet,
    });

    expect(tva.rattelser).toHaveLength(2);
    expect(tva.rattelser?.map((r) => r.till)).toEqual(['Swedol', 'Swedol AB']);
    // The first correction's "from" is still the text it was booked with.
    expect(tva.rattelser?.[0]?.fran).toBe('svecol');
  });

  it('refuses a correction that corrects nothing', () => {
    expect(() => ratta(bokfort(), { beskrivning: 'svecol', nar, enhet })).toThrow(
      TomRattelseError,
    );
    expect(() => ratta(bokfort(), { nar, enhet })).toThrow(TomRattelseError);
  });

  it('refuses to empty the description', () => {
    // BFL 5 kap. 7 §: a verifikation says what the affärshändelse avser.
    expect(() => ratta(bokfort(), { beskrivning: '   ', nar, enhet })).toThrow(TypeError);
  });

  it('trims, and treats a trimmed no-op as one', () => {
    expect(
      ratta(bokfort(), { beskrivning: '  Swedol AB  ', nar, enhet }).beskrivning,
    ).toBe('Swedol AB');
    expect(() => ratta(bokfort(), { beskrivning: ' svecol ', nar, enhet })).toThrow(
      TomRattelseError,
    );
  });

  describe('the project of a rad', () => {
    const P1 = '019b76da-a800-7000-8000-0000000000a1' as Uuid;
    const P2 = '019b76da-a800-7000-8000-0000000000a2' as Uuid;

    it('sets a project on a rad and records which rad and what it held', () => {
      const rattat = ratta(bokfort(), { projekt: [{ rad: 0, projekt: P1 }], nar, enhet });

      expect(rattat.konteringar.map((post) => post.projekt)).toEqual([
        P1,
        undefined,
        undefined,
      ]);
      expect(rattat.rattelser).toEqual([
        { nar, enhet, falt: 'projekt', rad: 0, fran: '', till: P1 },
      ]);
    });

    it('changes and takes away a project, keeping the old one beside the new', () => {
      const pa = ratta(bokfort(), { projekt: [{ rad: 0, projekt: P1 }], nar, enhet });
      const flyttat = ratta(pa, { projekt: [{ rad: 0, projekt: P2 }], nar, enhet });
      const borta = ratta(flyttat, { projekt: [{ rad: 0, projekt: null }], nar, enhet });

      expect(flyttat.konteringar[0]?.projekt).toBe(P2);
      expect(borta.konteringar[0]).not.toHaveProperty('projekt');
      expect(borta.rattelser?.map((post) => [post.fran, post.till])).toEqual([
        ['', P1],
        [P1, P2],
        [P2, ''],
      ]);
    });

    it('moves no money and no account, and leaves the other rows as they were', () => {
      const original = bokfort();
      const rattat = ratta(original, { projekt: [{ rad: 1, projekt: P1 }], nar, enhet });

      expect(rattat.konteringar.map(({ konto, belopp }) => [konto, belopp])).toEqual(
        original.konteringar.map(({ konto, belopp }) => [konto, belopp]),
      );
      expect(rattat.konteringar[0]).toBe(original.konteringar[0]);
      expect(rattat.konteringar[2]).toBe(original.konteringar[2]);
      expect(Object.isFrozen(rattat.konteringar[1])).toBe(true);
    });

    it('records one rättelse for each rad, alongside a corrected description', () => {
      const rattat = ratta(bokfort(), {
        beskrivning: 'Swedol AB',
        projekt: [
          { rad: 0, projekt: P1 },
          { rad: 2, projekt: P2 },
        ],
        nar,
        enhet,
      });

      expect(rattat.rattelser?.map((post) => [post.falt, post.rad])).toEqual([
        ['beskrivning', undefined],
        ['projekt', 0],
        ['projekt', 2],
      ]);
    });

    it('refuses a correction to the project a rad already has', () => {
      const pa = ratta(bokfort(), { projekt: [{ rad: 0, projekt: P1 }], nar, enhet });

      expect(() => ratta(pa, { projekt: [{ rad: 0, projekt: P1 }], nar, enhet })).toThrow(
        TomRattelseError,
      );
      expect(() =>
        ratta(bokfort(), { projekt: [{ rad: 0, projekt: null }], nar, enhet }),
      ).toThrow(TomRattelseError);
    });

    it('refuses a rad that does not exist, and one corrected twice', () => {
      expect(() =>
        ratta(bokfort(), { projekt: [{ rad: 3, projekt: P1 }], nar, enhet }),
      ).toThrow(RangeError);
      expect(() =>
        ratta(bokfort(), { projekt: [{ rad: -1, projekt: P1 }], nar, enhet }),
      ).toThrow(RangeError);
      expect(() =>
        ratta(bokfort(), {
          projekt: [
            { rad: 0, projekt: P1 },
            { rad: 0, projekt: P2 },
          ],
          nar,
          enhet,
        }),
      ).toThrow(RangeError);
    });
  });

  it('leaves the corrected verifikat as frozen as a booked one', () => {
    const rattat = ratta(bokfort(), { beskrivning: 'Swedol AB', nar, enhet });

    expect(Object.isFrozen(rattat)).toBe(true);
    expect(Object.isFrozen(rattat.konteringar)).toBe(true);
    expect(Object.isFrozen(rattat.rattelser)).toBe(true);
  });

  it('does not touch the original', () => {
    const original = bokfort();
    ratta(original, { beskrivning: 'Swedol AB', nar, enhet });

    expect(original.beskrivning).toBe('svecol');
    expect(original.rattelser).toBeUndefined();
  });
});
