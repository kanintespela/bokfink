import { describe, expect, it } from 'vitest';

import type { Uuid } from '../domain/id/uuidv7';
import { kontonummer, type Konto, type Kontonummer } from '../domain/konto/konto';
import { oreFromKronor } from '../domain/belopp/ore';
import { datum } from '../domain/tid/datum';
import type { Underlag } from '../domain/underlag/underlag';
import type { BokfortVerifikat } from '../domain/verifikat/verifikat';
import {
  avlasningsfraga,
  historikFor,
  motsagerHistoriken,
  konteringsfraga,
  kontrolleraAvlasning,
  plockaJson,
  somForslag,
  tolkaAvlasning,
  tolkaKontering,
  type Avlasning,
} from './lasning';

const IDAG = datum('2026-10-28');

/** The diesel receipt from the proof of concept, as the reader answered. */
const DIESEL: Avlasning = {
  leverantor: 'Preem Exempelvägen',
  orgnr: '556000-0001',
  datum: '2025-02-12',
  betalat: '1351.88',
  betalsatt: 'kort',
  riktning: 'utgift',
  rader: [{ momssats: 25, netto: '1081.50', moms: '270.38' }],
  avrundning: '0.00',
  sokord: ['diesel'],
  sakerhet: 'hog',
  kommentar: '',
};

/** An invoice with the moms worked out and 25 öre of rounding. */
const FAKTURA: Avlasning = {
  ...DIESEL,
  leverantor: 'Märkleverantören AB',
  betalsatt: 'faktura',
  betalat: '234.00',
  rader: [{ momssats: 25, netto: '187.00', moms: '46.75' }],
  avrundning: '0.25',
  sokord: ['öronmärken'],
};

let raknare = 0;
function verifikat(
  dag: string,
  beskrivning: string,
  rader: readonly [string, string][],
): BokfortVerifikat {
  raknare += 1;
  return {
    status: 'bokfort',
    id: `019b76da-a800-7000-8000-${String(raknare).padStart(12, '0')}` as Uuid,
    serie: 'A',
    nummer: raknare,
    datum: datum(dag),
    bokfortDatum: datum(dag),
    beskrivning,
    konteringar: rader.map(([konto, belopp]) => ({
      konto: kontonummer(konto),
      belopp: oreFromKronor(belopp),
    })),
  } as unknown as BokfortVerifikat;
}

describe('plockaJson', () => {
  it('finds the object inside a code fence or a sentence', () => {
    expect(plockaJson('Här är svaret:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('says so when there is none', () => {
    expect(() => plockaJson('Jag kan inte läsa bilden.')).toThrow('inget JSON-objekt');
  });
});

describe('tolkaAvlasning', () => {
  it('reads an answer of the agreed shape', () => {
    expect(tolkaAvlasning(JSON.stringify(DIESEL)).betalat).toBe('1351.88');
  });

  /* An amount as a number has been through a float already (hard rule 1). */
  it('refuses amounts that are not strings of kronor and öre', () => {
    expect(() => tolkaAvlasning(JSON.stringify({ ...DIESEL, betalat: 1351.88 }))).toThrow(
      'Avläsningen har fel form',
    );
    expect(() =>
      tolkaAvlasning(JSON.stringify({ ...DIESEL, betalat: '1 351,88' })),
    ).toThrow('123.45');
  });
});

describe('kontrolleraAvlasning', () => {
  it('accepts a reading that adds up, and gives the figures in öre', () => {
    const kontrollerad = kontrolleraAvlasning(DIESEL);
    expect(kontrollerad.betalat).toBe(oreFromKronor('1351.88'));
    expect(kontrollerad.moms).toBe(oreFromKronor('270.38'));
    expect(kontrollerad.datum).toBe('2025-02-12');
  });

  it('accepts an öresutjämning below a krona', () => {
    expect(kontrolleraAvlasning(FAKTURA).betalat).toBe(oreFromKronor('234'));
  });

  it('refuses figures that do not add up to what was paid', () => {
    expect(() => kontrolleraAvlasning({ ...DIESEL, betalat: '1352.88' })).toThrow(
      'går inte ihop',
    );
  });

  it('refuses a moms that is not the rate of its netto', () => {
    expect(() =>
      kontrolleraAvlasning({
        ...DIESEL,
        rader: [{ momssats: 12, netto: '1081.50', moms: '270.38' }],
      }),
    ).toThrow('inte 12 %');
  });

  it('refuses a rounding of a krona or more', () => {
    expect(() =>
      kontrolleraAvlasning({
        ...DIESEL,
        betalat: '1352.88',
        avrundning: '1.00',
      }),
    ).toThrow('en krona eller mer');
  });

  it('refuses a reading without a date or an amount, with the reader’s reason', () => {
    expect(() =>
      kontrolleraAvlasning({ ...DIESEL, datum: null, kommentar: 'Datumet är avrivet.' }),
    ).toThrow('Datumet är avrivet.');
    expect(() => kontrolleraAvlasning({ ...DIESEL, betalat: null })).toThrow(
      'Beloppet gick inte att läsa',
    );
  });
});

describe('historikFor', () => {
  const tidigt = verifikat('2024-04-14', 'Köp av diesel', [
    ['5600', '342.84'],
    ['2641', '85.71'],
    ['2013', '-428.55'],
  ]);
  const sent = verifikat('2026-06-08', 'Diesel', [
    ['5400', '275.79'],
    ['2640', '68.95'],
    ['2013', '-344.74'],
  ]);
  const annat = verifikat('2026-07-01', 'Foder', [
    ['4000', '100.00'],
    ['2013', '-100.00'],
  ]);
  const franButiken = verifikat('2026-05-01', 'Spolarvätska', [
    ['5400', '80.00'],
    ['2013', '-80.00'],
  ]);
  const alla = new Map([tidigt, sent, annat, franButiken].map((post) => [post.id, post]));

  /* What the receipt says it is, matched in the descriptions, latest first. */
  it('finds the same kind of purchase, the latest first', () => {
    expect(historikFor(DIESEL, [], alla, IDAG)).toEqual([sent, tidigt]);
  });

  /*
   * The same supplier by its organisationsnummer, read off an earlier
   * receipt - whatever was bought there and however it was described.
   */
  it('finds the same supplier through earlier receipts', () => {
    const kvitto = {
      text: 'Preem Exempelvägen\nOrg.nr 556000-0001\nSpolarvätska 80,00',
      verifikat: [franButiken.id],
    } as unknown as Underlag;

    expect(historikFor(DIESEL, [kvitto], alla, IDAG)).toContain(franButiken);
  });

  it('does not match on short words or company forms', () => {
    const kort: Avlasning = { ...DIESEL, leverantor: 'Ab Hö', sokord: ['hö'] };
    expect(historikFor(kort, [], alla, IDAG)).toEqual([]);
  });
});

describe('somForslag', () => {
  const kontrollerad = kontrolleraAvlasning(DIESEL);

  it('passes on a booking that pays what the receipt says', () => {
    const forslag = somForslag(
      kontrollerad,
      tolkaKontering(
        JSON.stringify({
          beskrivning: 'Preem: diesel',
          konteringar: [
            { konto: '5400', belopp: '1081.50' },
            { konto: '2640', belopp: '270.38' },
            { konto: '2013', belopp: '-1351.88' },
          ],
          motivering: 'Som de senaste dieselköpen.',
        }),
      ),
    );
    expect(forslag.datum).toBe('2025-02-12');
    expect(forslag.konteringar).toHaveLength(3);
  });

  /* Balanced, and of a different amount: the one error the review cannot see. */
  it('refuses a booking that balances on another amount', () => {
    expect(() =>
      somForslag(kontrollerad, {
        beskrivning: 'Preem: diesel',
        konteringar: [
          { konto: '5400', belopp: '1000.00' },
          { konto: '2013', belopp: '-1000.00' },
        ],
        motivering: '',
      }),
    ).toThrow('Ingen rad i konteringen är betalningen');
  });

  /* Rounded down: 3740 on the credit side, the payment still one row. */
  it('accepts an avrundning on either side', () => {
    const nedat = kontrolleraAvlasning({
      ...DIESEL,
      betalat: '211.00',
      rader: [{ momssats: 25, netto: '169.00', moms: '42.25' }],
      avrundning: '-0.25',
    });
    expect(() =>
      somForslag(nedat, {
        beskrivning: 'Program',
        konteringar: [
          { konto: '5420', belopp: '169.00' },
          { konto: '2640', belopp: '42.25' },
          { konto: '1930', belopp: '-211.00' },
          { konto: '3740', belopp: '-0.25' },
        ],
        motivering: '',
      }),
    ).not.toThrow();
  });
});

/*
 * 2026-10-29: a slaughterhouse's settlement - money in - came back with the
 * amount paid as -15425.00, and every booking was refused for having no row
 * of the payment. Money in is still an amount paid; the sign says which way.
 */
describe('a receipt for money in', () => {
  const AVRAKNING: Avlasning = {
    ...DIESEL,
    leverantor: 'Slakteriet',
    betalsatt: 'faktura',
    riktning: 'inkomst',
    betalat: '-15425.00',
    rader: [{ momssats: 25, netto: '-12339.96', moms: '-3084.99' }],
    avrundning: '-0.05',
    sokord: ['lamm'],
  };

  it('is read and booked with the money coming in', () => {
    const kontrollerad = kontrolleraAvlasning(AVRAKNING);
    expect(kontrollerad.betalat).toBe(oreFromKronor('15425'));

    expect(() =>
      somForslag(kontrollerad, {
        beskrivning: 'Slakteriet: lamm',
        konteringar: [
          { konto: '1930', belopp: '15425.00' },
          { konto: '3000', belopp: '-12339.96' },
          { konto: '2631', belopp: '-3084.99' },
          { konto: '3740', belopp: '-0.05' },
        ],
        motivering: '',
      }),
    ).not.toThrow();
  });

  it('reads the same when the amounts come positive', () => {
    const positiv: Avlasning = {
      ...AVRAKNING,
      betalat: '15425.00',
      rader: [{ momssats: 25, netto: '12339.96', moms: '3084.99' }],
      avrundning: '0.05',
    };
    expect(kontrolleraAvlasning(positiv).betalat).toBe(oreFromKronor('15425'));
  });
});

/*
 * 2026-10-29: an invoice for barley, the firm under "Köpare", was read as a
 * sale - the reader did not know who the firm was, and took the sender for
 * it - although the last barley in the books was a purchase.
 */
describe('which way the money went', () => {
  it('tells the reader who the firm is', () => {
    const fraga = avlasningsfraga({ foretag: 'Anna Exempelsson' });
    expect(fraga).toContain('Firman är Anna Exempelsson');
    expect(fraga).toContain('köpare');
  });

  const inkop = verifikat('2025-10-29', 'Inköp av korn', [
    ['4010', '1050.00'],
    ['2640', '262.50'],
    ['1930', '-1312.50'],
  ]);
  const forsaljning = verifikat('2025-10-25', 'Försäljning av lamm', [
    ['1930', '15425.00'],
    ['3000', '-15425.00'],
  ]);

  it('says when the reading goes against the earlier bookings', () => {
    const salt: Avlasning = { ...DIESEL, riktning: 'inkomst', sokord: ['korn'] };
    expect(motsagerHistoriken(salt, [inkop])).toContain('inköp');
    expect(motsagerHistoriken({ ...salt, riktning: 'utgift' }, [inkop])).toBeUndefined();
    expect(motsagerHistoriken(salt, [forsaljning])).toBeUndefined();
    expect(motsagerHistoriken(salt, [])).toBeUndefined();
  });

  /* "vete" is not in "veterinärkostnad". */
  it('matches whole words in the descriptions', () => {
    const vet = verifikat('2025-03-21', 'Veterinärkostnad', [
      ['6991', '100.00'],
      ['1930', '-100.00'],
    ]);
    const vete = verifikat('2025-04-15', 'Köp av vete', [
      ['5400', '100.00'],
      ['1930', '-100.00'],
    ]);
    const alla = new Map([vet, vete].map((post) => [post.id, post]));
    expect(
      historikFor({ ...DIESEL, leverantor: null, sokord: ['vete'] }, [], alla, IDAG),
    ).toEqual([vete]);
  });
});

describe('för en förening', () => {
  it('asks the reader about an association, not a firm', () => {
    const fraga = avlasningsfraga({ foretag: 'Exempelföreningen', profil: 'forening' });
    expect(fraga).toContain('en ideell förening i Sverige');
    expect(fraga).toContain('Föreningen är Exempelföreningen');
    expect(fraga).not.toContain('lantbruk med får');
    expect(fraga).not.toContain('Firman');
    expect(fraga).not.toContain('slakteri');
  });

  it('is unchanged for a firm', () => {
    expect(avlasningsfraga({ profil: 'enskild_firma' })).toBe(avlasningsfraga());
    expect(avlasningsfraga()).toContain('enskild firma i Sverige (lantbruk med får)');
  });

  it('tells the booking question that there is no moms to split off', () => {
    const fraga = konteringsfraga(DIESEL, [], new Map(), 'kontantmetoden', 'forening');
    expect(fraga).toContain('ideell förening');
    expect(fraga).toContain('inte momsregistrerad');
    expect(fraga).toContain('ska inte finnas någon momsrad');
    expect(fraga).toContain('bankkontot 1930');
    expect(fraga).not.toContain('Avrundning på 3740');
    expect(fraga).not.toContain('utgående momsen');
  });

  it("offers the association's own answers, not the firm's", () => {
    const fraga = konteringsfraga(DIESEL, [], new Map(), 'kontantmetoden', 'forening');
    expect(fraga).toContain('f-el | El | 5020');
    expect(fraga).toContain('f-medlem | Medlemsavgift | 3610');
    expect(fraga).not.toContain('foder |');
  });

  it("keeps a firm's question as it was", () => {
    const fraga = konteringsfraga(DIESEL, [], new Map());
    expect(fraga).toContain('Avrundning på 3740');
    expect(fraga).toContain('Firman bokför med kontantmetoden');
  });
});

describe('konteringsfraga', () => {
  it('carries the reading, the history and only the active accounts', () => {
    const konton = new Map<Kontonummer, Konto>([
      [
        kontonummer('5400'),
        { nummer: '5400', namn: 'Förbrukningsinventarier', aktiv: true },
      ],
      [kontonummer('5410'), { nummer: '5410', namn: 'Gammalt konto', aktiv: false }],
    ] as [Kontonummer, Konto][]);
    const historik = [
      verifikat('2026-06-08', 'Diesel', [
        ['5400', '275.79'],
        ['2013', '-275.79'],
      ]),
    ];

    const fraga = konteringsfraga(DIESEL, historik, konton);
    expect(fraga).toContain('"betalat":"1351.88"');
    expect(fraga).toContain('2026-06-08 Diesel: 5400 275.79, 2013 -275.79');
    expect(fraga).toContain('5400 Förbrukningsinventarier');
    expect(fraga).not.toContain('Gammalt konto');
  });
});
