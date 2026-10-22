import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { skapaAnlaggningstillgang } from '../anlaggning/anlaggningstillgang';
import { oreFromKronor } from '../belopp/ore';
import { kontonummer, skapaKonto } from '../konto/konto';
import { skapaRakenskapsar } from '../rakenskapsar/rakenskapsar';
import { datum } from '../tid/datum';
import { uuidv7, type Uuid } from '../id/uuidv7';
import { bokfor, skapaUtkast } from '../verifikat/verifikat';
import { verifikatserie } from '../verifikat/serie';
import { bygg, LoggkonfliktError, type Handelse } from './handelse';

const ENHET = 'enhet-a';
let klockslag = 1_788_554_081_339;

/** Ids in the order they are minted, which is the order the log applies. */
function nyttId(): Uuid {
  klockslag += 1;
  return uuidv7(klockslag, new Uint8Array(10).fill(7));
}

function huvud() {
  return { id: nyttId(), enhet: ENHET, tidpunkt: '2026-09-05T08:00:00.000Z' };
}

const AR_ID = '019b76da-a800-7000-8000-0000000000aa' as Uuid;

const arSkapat = (): Handelse => ({
  ...huvud(),
  typ: 'rakenskapsar.skapat',
  rakenskapsar: skapaRakenskapsar({
    id: AR_ID,
    start: datum('2026-01-01'),
    slut: datum('2026-12-31'),
  }),
});

const kontoSkapat = (nummer: string, namn: string): Handelse => ({
  ...huvud(),
  typ: 'konto.skapat',
  konto: skapaKonto({ nummer, namn }),
});

function utkastMed(id: Uuid, beskrivning: string) {
  return skapaUtkast({
    id,
    datum: datum('2026-01-09'),
    beskrivning,
    konteringar: [
      { konto: kontonummer('4010'), belopp: oreFromKronor('416.25') },
      { konto: kontonummer('2013'), belopp: oreFromKronor('-416.25') },
    ],
  });
}

describe('bygg', () => {
  it('builds an empty ledger from an empty log', () => {
    const tillstand = bygg([]);
    expect(tillstand.konton.size).toBe(0);
    expect(tillstand.verifikat.size).toBe(0);
  });

  it('collects accounts and fiscal years', () => {
    const tillstand = bygg([
      arSkapat(),
      kontoSkapat('4010', 'Inköp material och varor'),
      kontoSkapat('2013', 'Eget uttag/insättningar'),
    ]);

    expect([...tillstand.konton.keys()]).toEqual(['4010', '2013']);
    expect(tillstand.rakenskapsar.get(AR_ID)?.start).toBe('2026-01-01');
  });

  it('lets a later change to an account win', () => {
    const forst = kontoSkapat('4010', 'Inköp');
    const sedan: Handelse = {
      ...huvud(),
      typ: 'konto.andrat',
      konto: skapaKonto({
        nummer: '4010',
        namn: 'Inköp material och varor',
        favorit: true,
      }),
    };

    const tillstand = bygg([forst, sedan]);
    expect(tillstand.konton.get(kontonummer('4010'))?.favorit).toBe(true);
  });

  it('applies a VAT lock and a year end to the year already in the log', () => {
    const tillstand = bygg([
      arSkapat(),
      {
        ...huvud(),
        typ: 'rakenskapsar.momslast',
        rakenskapsarId: AR_ID,
        tom: datum('2026-03-31'),
      },
    ]);
    expect(tillstand.rakenskapsar.get(AR_ID)?.momslastTom).toBe('2026-03-31');

    const avslutat = bygg([
      arSkapat(),
      { ...huvud(), typ: 'rakenskapsar.avslutat', rakenskapsarId: AR_ID },
    ]);
    expect(avslutat.rakenskapsar.get(AR_ID)?.avslutat).toBe(true);
  });

  it('keeps and removes drafts', () => {
    const utkastId = nyttId();
    const sparat: Handelse = {
      ...huvud(),
      typ: 'utkast.sparat',
      utkast: utkastMed(utkastId, 'Inköp av kraftfoder'),
    };

    expect(bygg([sparat]).utkast.size).toBe(1);
    expect(
      bygg([sparat, { ...huvud(), typ: 'utkast.borttaget', utkastId }]).utkast.size,
    ).toBe(0);
  });

  it('consumes the draft when its verifikat is booked', () => {
    const id = nyttId();
    const tillstand = bygg([
      { ...huvud(), typ: 'utkast.sparat', utkast: utkastMed(id, 'Inköp') },
      {
        ...huvud(),
        typ: 'verifikat.bokfort',
        verifikat: bokfor(utkastMed(id, 'Inköp'), {
          serie: verifikatserie('A'),
          nummer: 1,
          bokfortDatum: datum('2026-01-12'),
          kalla: 'manuell',
        }),
      },
    ]);

    expect(tillstand.utkast.size).toBe(0);
    expect(tillstand.verifikat.size).toBe(1);
  });

  /*
   * The property the whole design rests on: the log is the source of truth,
   * so the books it describes must not depend on the order entries arrived
   * in. Two devices exchanging logs reach the same state without negotiating.
   */
  it('gives the same books whatever order the log arrives in', () => {
    const logg: Handelse[] = [
      arSkapat(),
      kontoSkapat('4010', 'Inköp material och varor'),
      kontoSkapat('2013', 'Eget uttag/insättningar'),
      {
        ...huvud(),
        typ: 'rakenskapsar.momslast',
        rakenskapsarId: AR_ID,
        tom: datum('2026-03-31'),
      },
    ];
    const forvantat = bygg(logg);

    fc.assert(
      fc.property(fc.shuffledSubarray(logg, { minLength: logg.length }), (blandad) => {
        const tillstand = bygg(blandad);
        expect([...tillstand.konton.entries()]).toEqual([...forvantat.konton.entries()]);
        expect([...tillstand.rakenskapsar.entries()]).toEqual([
          ...forvantat.rakenskapsar.entries(),
        ]);
      }),
    );
  });

  it('is unchanged by an entry that arrives twice, as a sync will send it', () => {
    const logg = [arSkapat(), kontoSkapat('4010', 'Inköp')];
    const enGang = bygg(logg);
    const tvaGanger = bygg([...logg, ...logg]);

    expect([...tvaGanger.konton.entries()]).toEqual([...enGang.konton.entries()]);
    expect(tvaGanger.rakenskapsar.size).toBe(1);
  });

  it('refuses a log that books the same verifikat twice', () => {
    const id = nyttId();
    const bokfort = (nummer: number): Handelse => ({
      ...huvud(),
      typ: 'verifikat.bokfort',
      verifikat: bokfor(utkastMed(id, 'Inköp'), {
        serie: verifikatserie('A'),
        nummer,
        bokfortDatum: datum('2026-01-12'),
        kalla: 'manuell',
      }),
    });

    expect(() => bygg([bokfort(1), bokfort(2)])).toThrow(LoggkonfliktError);
  });

  /*
   * A correction is an entry like any other, and the entry is the record BFL
   * 5 kap. 8 § asks for: tidpunkt is när, enhet is vem.
   */
  it('applies a correction to the verifikat it names', () => {
    const id = nyttId();
    const bokfort: Handelse = {
      ...huvud(),
      typ: 'verifikat.bokfort',
      verifikat: bokfor(utkastMed(id, 'svecol'), {
        serie: verifikatserie('A'),
        nummer: 1,
        bokfortDatum: datum('2026-09-16'),
        kalla: 'manuell',
      }),
    };
    const rattat: Handelse = {
      ...huvud(),
      tidpunkt: '2026-09-17T09:15:00.000Z',
      typ: 'verifikat.rattat',
      verifikatId: id,
      beskrivning: 'Swedol AB',
    };

    const verifikat = bygg([bokfort, rattat]).verifikat.get(id);

    expect(verifikat?.beskrivning).toBe('Swedol AB');
    expect(verifikat?.rattelser).toEqual([
      {
        nar: '2026-09-17T09:15:00.000Z',
        enhet: ENHET,
        falt: 'beskrivning',
        fran: 'svecol',
        till: 'Swedol AB',
      },
    ]);
  });

  it('refuses a correction to a verifikat the log never booked', () => {
    expect(() =>
      bygg([
        {
          ...huvud(),
          typ: 'verifikat.rattat',
          verifikatId: nyttId(),
          beskrivning: 'Fel',
        },
      ]),
    ).toThrow(LoggkonfliktError);
  });

  it('refuses to lock a year the log never created', () => {
    expect(() =>
      bygg([
        {
          ...huvud(),
          typ: 'rakenskapsar.momslast',
          rakenskapsarId: AR_ID,
          tom: datum('2026-03-31'),
        },
      ]),
    ).toThrow(LoggkonfliktError);
  });

  it('registers an anläggningstillgång and marks it avyttrad', () => {
    const id = nyttId();
    const tillgang = skapaAnlaggningstillgang({
      id,
      benamning: 'Betgrep',
      anskaffningsdatum: datum('2026-01-09'),
      anskaffningsvarde: oreFromKronor('50000'),
      nyttjandeperiod: 10,
    });

    const registrerad = bygg([{ ...huvud(), typ: 'anlaggning.registrerad', tillgang }]);
    expect(registrerad.anlaggningar.get(id)?.avyttring).toBeUndefined();

    const avyttrad = bygg([
      { ...huvud(), typ: 'anlaggning.registrerad', tillgang },
      {
        ...huvud(),
        typ: 'anlaggning.avyttrad',
        tillgangId: id,
        avyttring: {
          datum: datum('2026-06-01'),
          typ: 'forsaljning',
          forsaljningsinkomst: oreFromKronor('37000'),
        },
      },
    ]);
    expect(avyttrad.anlaggningar.get(id)?.avyttring?.forsaljningsinkomst).toBe(
      oreFromKronor('37000'),
    );
  });

  it('refuses a log that registers the same anläggningstillgång twice', () => {
    const tillgang = skapaAnlaggningstillgang({
      id: nyttId(),
      benamning: 'Betgrep',
      anskaffningsdatum: datum('2026-01-09'),
      anskaffningsvarde: oreFromKronor('50000'),
      nyttjandeperiod: 10,
    });

    expect(() =>
      bygg([
        { ...huvud(), typ: 'anlaggning.registrerad', tillgang },
        { ...huvud(), typ: 'anlaggning.registrerad', tillgang },
      ]),
    ).toThrow(LoggkonfliktError);
  });

  it('refuses to avyttra an anläggningstillgång the log never registered', () => {
    expect(() =>
      bygg([
        {
          ...huvud(),
          typ: 'anlaggning.avyttrad',
          tillgangId: nyttId(),
          avyttring: {
            datum: datum('2026-06-01'),
            typ: 'utrangering',
            forsaljningsinkomst: oreFromKronor('0'),
          },
        },
      ]),
    ).toThrow(LoggkonfliktError);
  });
});
