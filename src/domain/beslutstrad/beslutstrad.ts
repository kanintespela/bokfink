import type { Uuid } from '../id/uuidv7';
import { kontonummer, type Kontonummer } from '../konto/konto';
import type { Konteringsmall, Riktning } from '../mall/konteringsmall';
import { forvaltMomskonto } from '../moms/momskonto';
import type { Datum } from '../tid/datum';

/**
 * Booking by answering questions instead of picking a template.
 *
 * "Pengar ut", "Pengar in", "Flytta pengar", "Moms": a few answers lead to
 * a leaf that knows the BAS K1 account, the moms and the ways it can have
 * been paid. The owner's decision of 2026-09-13 replaced the fixed templates
 * with this tree. Hard rule 10 still holds: a leaf fills in the form, and
 * the posting it proposes can be changed before anything is booked.
 *
 * The accounts are BAS K1 2018's, the chart for a sole trader with a
 * förenklat årsbokslut. The moms of each leaf carries its source.
 */

export type Momssats = 0 | 6 | 12 | 25;

export type Momsval =
  /** The rate follows from what it is. */
  | { readonly typ: 'fast'; readonly sats: Momssats }
  /** Food, whose rate depends on the date; see {@link momsForLov}. */
  | { readonly typ: 'livsmedel' }
  /** The receipt decides; the form asks, starting from `forval`. */
  | { readonly typ: 'fraga'; readonly forval: Momssats; readonly hjalp: string };

export interface Lov {
  readonly typ: 'lov';
  /** Stable for ever: it becomes the verifikat's mall id. Lowercase ASCII. */
  readonly id: string;
  readonly namn: string;
  readonly sokord: readonly string[];
  readonly riktning: Riktning;
  readonly konto: Kontonummer;
  readonly moms: Momsval;
  /** The accounts the money can have gone through, most likely first. */
  readonly betalsatt: readonly Kontonummer[];
  /** Labels for the amount and the payment, where the defaults read wrong. */
  readonly ord?: { readonly belopp: string; readonly konto: string };
  /** Something worth knowing before booking it. */
  readonly ledtext?: string;
  readonly kalla: string;
}

/** A leaf that is not booked here, but on a screen of its own. */
export interface Hanvisning {
  readonly typ: 'hanvisning';
  readonly id: string;
  readonly till: 'moms' | 'lager' | 'periodisering' | 'anlaggning' | 'egetkapital';
  readonly text: string;
}

export interface Fraga {
  readonly typ: 'fraga';
  readonly id: string;
  readonly fraga: string;
  readonly hjalp?: string;
  /** Show this year's halvt prisbasbelopp beside the question. */
  readonly visaHalvtPrisbasbelopp?: boolean;
  readonly svar: readonly Svar[];
}

export interface Svar {
  readonly text: string;
  readonly till: Nod;
}

export type Nod = Fraga | Lov | Hanvisning;

/** What each payment account is called where it is offered. */
export const BETALSATTSNAMN: ReadonlyMap<Kontonummer, string> = new Map([
  [kontonummer('1930'), 'Företagskontot'],
  [kontonummer('2017'), 'Egna pengar'],
  [kontonummer('2013'), 'Mitt privata konto'],
  [kontonummer('1910'), 'Kassan'],
  [kontonummer('2012'), 'Skattekontot'],
]);

const K = kontonummer;

/*
 * Paid with one's own money is an egen insättning (2017); received on a
 * private account an eget uttag (2013). Most purchases in the books this was
 * built for were paid privately, so that comes first.
 */
const INKOP = [K('2017'), K('1930'), K('1910')];
const INTAKT = [K('1930'), K('2013'), K('1910')];
const BANK = [K('1930')];

const BAS_K1 = 'BAS K1 2018';
const MOMS_25 =
  'Mervärdesskattelagen (2023:200) 9 kap.: 25 % är normalskattesatsen. ' + BAS_K1;
const FORSAKRING =
  'Mervärdesskattelagen (2023:200) 10 kap. 32 §: försäkringstjänster är undantagna från moms. ' +
  BAS_K1;
const FINANSIELL =
  'Mervärdesskattelagen (2023:200) 10 kap. 33 §: finansiella tjänster är undantagna från moms. ' +
  BAS_K1;
const INGEN_OMSATTNING =
  'Mervärdesskattelagen (2023:200) 3 kap. 1 §: moms tas ut på leveranser mot ersättning, ' +
  'och att flytta egna eller lånade pengar är ingen leverans. ' +
  BAS_K1;

const LIVSMEDEL =
  'Mervärdesskattelagen (2023:200) 9 kap. 19 §: livsmedel har reducerad skattesats. ' +
  'Skatteverket 2026: 6 % från 1 april 2026 till och med 31 december 2027, dessförinnan 12 %. ' +
  BAS_K1;

export function lov(
  uppgifter: Omit<Lov, 'typ' | 'konto' | 'betalsatt'> & {
    readonly konto: string;
    readonly betalsatt: readonly Kontonummer[];
  },
): Lov {
  return { ...uppgifter, typ: 'lov', konto: K(uppgifter.konto) };
}

export function fast(sats: Momssats): Momsval {
  return { typ: 'fast', sats };
}

// Leaves reached from more than one place in the tree.

const EGEN_INSATTNING = lov({
  id: 'egen-insattning',
  namn: 'Egen insättning',
  sokord: ['insättning', 'egna pengar', 'privat'],
  riktning: 'inkomst',
  konto: '2017',
  moms: fast(0),
  betalsatt: [K('1930'), K('1910')],
  ord: { belopp: 'Belopp', konto: 'Insatt på' },
  ledtext: 'Pengar du för över från dig själv till firman. Det är ingen intäkt.',
  kalla: INGEN_OMSATTNING,
});

const NYTT_LAN = lov({
  id: 'nytt-lan',
  namn: 'Nytt lån',
  sokord: ['lån', 'kredit', 'banklån'],
  riktning: 'inkomst',
  konto: '2350',
  moms: fast(0),
  betalsatt: BANK,
  ord: { belopp: 'Lånebelopp', konto: 'Insatt på' },
  kalla: INGEN_OMSATTNING,
});

const AMORTERING = lov({
  id: 'amortering',
  namn: 'Amortering på lån',
  sokord: ['amortering', 'avbetalning', 'lån'],
  riktning: 'utgift',
  konto: '2350',
  moms: fast(0),
  betalsatt: [K('1930'), K('2017')],
  ledtext:
    'Bara amorteringen. Räntan bokförs för sig, under Försäkring, bank och avgifter.',
  kalla: INGEN_OMSATTNING,
});

const MOMS_BETALD = lov({
  id: 'moms-betald',
  namn: 'Betalat moms',
  sokord: ['moms', 'skatteverket', 'momsbetalning'],
  riktning: 'utgift',
  konto: '2650',
  moms: fast(0),
  betalsatt: [K('2012'), K('1930')],
  ord: { belopp: 'Belopp', konto: 'Betalat från' },
  ledtext:
    'Momsen dras oftast från skattekontot. Har du betalat direkt från banken, välj Företagskontot.',
  kalla: BAS_K1 + ': 2650 Redovisningskonto för moms, 2012 skattekontot',
});

const MOMS_TILLBAKA = lov({
  id: 'moms-tillbaka',
  namn: 'Fått tillbaka moms',
  sokord: ['moms', 'skatteverket', 'återbetalning'],
  riktning: 'inkomst',
  konto: '2650',
  moms: fast(0),
  betalsatt: [K('2012'), K('1930')],
  ord: { belopp: 'Belopp', konto: 'Insatt på' },
  kalla: BAS_K1 + ': 2650 Redovisningskonto för moms, 2012 skattekontot',
});

const MOMSREDOVISNING: Hanvisning = {
  typ: 'hanvisning',
  id: 'momsredovisning',
  till: 'moms',
  text: 'Momsen för en period räknas fram och bokförs under Moms.',
};

const PENGAR_UT: Fraga = {
  typ: 'fraga',
  id: 'pengar-ut',
  fraga: 'Vad har du betalat för?',
  svar: [
    {
      text: 'Djuren',
      till: {
        typ: 'fraga',
        id: 'djuren',
        fraga: 'Vad till djuren?',
        svar: [
          {
            text: 'Foder, strö eller mineraler',
            till: lov({
              id: 'foder',
              namn: 'Foder och strö',
              sokord: [
                'foder',
                'kraftfoder',
                'ensilage',
                'hö',
                'halm',
                'strö',
                'mineral',
                'pellets',
                'saltsten',
                'slicksten',
                'mineralsten',
              ],
              riktning: 'utgift',
              konto: '4000',
              moms: fast(25),
              betalsatt: INKOP,
              kalla:
                'Djurfoder har normalskattesatsen, det är inte livsmedel. ' + MOMS_25,
            }),
          },
          {
            text: 'Köpta djur',
            till: lov({
              id: 'djurkop',
              namn: 'Köpta djur',
              sokord: ['djur', 'bagge', 'tacka', 'lamm', 'kalv'],
              riktning: 'utgift',
              konto: '4000',
              moms: fast(25),
              betalsatt: INKOP,
              ledtext: 'Djuren räknas med i lagret när du inventerar vid årets slut.',
              kalla: 'Skatteverket: levande djur har 25 % moms. ' + BAS_K1,
            }),
          },
          {
            text: 'Veterinär, klippning eller annan tjänst',
            till: lov({
              id: 'djurtjanst',
              namn: 'Veterinär och tjänster till djuren',
              sokord: ['veterinär', 'klippning', 'klövvård', 'seminering', 'analys'],
              riktning: 'utgift',
              konto: '6500',
              moms: fast(25),
              betalsatt: INKOP,
              kalla: MOMS_25,
            }),
          },
          {
            text: 'Medicin, öronmärken eller annat till djurvården',
            till: lov({
              id: 'djurvard',
              namn: 'Medicin och djurvård',
              sokord: ['medicin', 'avmaskning', 'öronmärke', 'märkning', 'djurvård'],
              riktning: 'utgift',
              konto: '5400',
              moms: fast(25),
              betalsatt: INKOP,
              kalla: MOMS_25,
            }),
          },
          {
            text: 'Transport eller slakt',
            till: lov({
              id: 'djurtransport',
              namn: 'Transport och slakt',
              sokord: ['transport', 'slakt', 'slakteri', 'djurtransport', 'frakt'],
              riktning: 'utgift',
              konto: '5700',
              moms: fast(25),
              betalsatt: INKOP,
              kalla: MOMS_25,
            }),
          },
        ],
      },
    },
    {
      text: 'Maskiner, verktyg och material',
      till: {
        typ: 'fraga',
        id: 'maskiner',
        fraga: 'Vad gäller det?',
        svar: [
          {
            text: 'Köpt en maskin, ett verktyg eller en inventarie',
            till: {
              typ: 'fraga',
              id: 'inventarie',
              fraga:
                'Kostar den mer än ett halvt prisbasbelopp utan moms, och håller den längre än tre år?',
              hjalp:
                'Saker som köps tillsammans och hör ihop räknas som en. Är svaret nej på någon av frågorna blir det en vanlig kostnad direkt.',
              visaHalvtPrisbasbelopp: true,
              svar: [
                {
                  text: 'Ja, båda',
                  till: lov({
                    id: 'inventarie',
                    namn: 'Maskin eller inventarie',
                    sokord: ['maskin', 'traktor', 'inventarie', 'redskap'],
                    riktning: 'utgift',
                    konto: '1221',
                    moms: fast(25),
                    betalsatt: INKOP,
                    ledtext:
                      'Lägg också in den under Anläggningar, så att den skrivs av.',
                    kalla:
                      'BFNAR 2006:1 punkt 6.30 och 6.31: bara en inventarie över ett halvt prisbasbelopp med längre nyttjandeperiod än tre år tas upp som tillgång. ' +
                      MOMS_25,
                  }),
                },
                {
                  text: 'Nej',
                  till: lov({
                    id: 'smainventarie',
                    namn: 'Verktyg och mindre inventarier',
                    sokord: ['verktyg', 'redskap', 'inventarie'],
                    riktning: 'utgift',
                    konto: '5400',
                    moms: fast(25),
                    betalsatt: INKOP,
                    kalla:
                      'BFNAR 2006:1 punkt 6.30 och 6.31: en inventarie av mindre värde eller med kort nyttjandeperiod blir en kostnad direkt. ' +
                      MOMS_25,
                  }),
                },
              ],
            },
          },
          {
            text: 'Material, reservdelar eller stängsel',
            till: lov({
              id: 'material',
              namn: 'Förbrukningsmaterial',
              sokord: [
                'material',
                'reservdel',
                'stängsel',
                'skruv',
                'olja',
                'järnhandel',
              ],
              riktning: 'utgift',
              konto: '5400',
              moms: fast(25),
              betalsatt: INKOP,
              kalla: MOMS_25,
            }),
          },
          {
            text: 'Reparation eller service av en maskin',
            till: lov({
              id: 'maskinservice',
              namn: 'Reparation av maskin',
              sokord: ['reparation', 'service', 'verkstad'],
              riktning: 'utgift',
              konto: '5500',
              moms: fast(25),
              betalsatt: INKOP,
              kalla: MOMS_25,
            }),
          },
          {
            text: 'Drivmedel till traktor eller maskin',
            till: lov({
              id: 'drivmedel',
              namn: 'Drivmedel till traktor eller maskin',
              sokord: ['diesel', 'bensin', 'aspen', 'drivmedel', 'bränsle'],
              riktning: 'utgift',
              konto: '5600',
              moms: fast(25),
              betalsatt: INKOP,
              kalla: MOMS_25,
            }),
          },
        ],
      },
    },
    {
      text: 'Bilen',
      till: {
        typ: 'fraga',
        id: 'bilen',
        fraga: 'Vad till bilen?',
        hjalp: 'Gäller en bil som hör till firman.',
        svar: [
          {
            text: 'Drivmedel',
            till: lov({
              id: 'bil-drivmedel',
              namn: 'Drivmedel till bilen',
              sokord: ['bensin', 'diesel', 'tankning', 'laddning'],
              riktning: 'utgift',
              konto: '5611',
              moms: fast(25),
              betalsatt: INKOP,
              kalla: MOMS_25,
            }),
          },
          {
            text: 'Reparation och service',
            till: lov({
              id: 'bil-reparation',
              namn: 'Reparation av bilen',
              sokord: ['bilverkstad', 'service', 'däck', 'besiktning'],
              riktning: 'utgift',
              konto: '5613',
              moms: fast(25),
              betalsatt: INKOP,
              kalla: MOMS_25,
            }),
          },
          {
            text: 'Försäkring eller fordonsskatt',
            till: lov({
              id: 'bil-forsakring',
              namn: 'Bilförsäkring och fordonsskatt',
              sokord: ['bilförsäkring', 'fordonsskatt', 'trafikförsäkring'],
              riktning: 'utgift',
              konto: '5612',
              moms: fast(0),
              betalsatt: INKOP,
              kalla: FORSAKRING,
            }),
          },
        ],
      },
    },
    {
      text: 'Byggnader, el och mark',
      till: lov({
        id: 'fastighet',
        namn: 'Byggnader, el och mark',
        sokord: ['el', 'elräkning', 'ladugård', 'byggnad', 'vatten', 'sophämtning'],
        riktning: 'utgift',
        konto: '5100',
        moms: fast(25),
        betalsatt: INKOP,
        ledtext:
          'Reparation, el och drift av det firman använder, till exempel ekonomibyggnader.',
        kalla: MOMS_25,
      }),
    },
    {
      text: 'Telefon, internet, program och kontor',
      till: {
        typ: 'fraga',
        id: 'kontor',
        fraga: 'Vad gäller det?',
        svar: [
          {
            text: 'Telefon, internet eller porto',
            till: lov({
              id: 'tele',
              namn: 'Telefon, internet och porto',
              sokord: ['telefon', 'mobil', 'internet', 'bredband', 'porto', 'frimärke'],
              riktning: 'utgift',
              konto: '6200',
              moms: fast(25),
              betalsatt: INKOP,
              kalla: MOMS_25,
            }),
          },
          {
            text: 'Program, appar eller abonnemang',
            till: lov({
              id: 'programvara',
              namn: 'Program och abonnemang',
              sokord: ['program', 'app', 'abonnemang', 'licens', 'molntjänst'],
              riktning: 'utgift',
              konto: '5400',
              moms: fast(25),
              betalsatt: INKOP,
              kalla: MOMS_25,
            }),
          },
          {
            text: 'Kontorsmaterial eller trycksaker',
            till: lov({
              id: 'kontorsmaterial',
              namn: 'Kontorsmaterial och trycksaker',
              sokord: ['papper', 'skrivare', 'toner', 'pärm', 'trycksak'],
              riktning: 'utgift',
              konto: '6100',
              moms: fast(25),
              betalsatt: INKOP,
              kalla: MOMS_25,
            }),
          },
        ],
      },
    },
    {
      text: 'Tjänster, reklam och frakt',
      till: {
        typ: 'fraga',
        id: 'tjanster',
        fraga: 'Vad gäller det?',
        svar: [
          {
            text: 'Redovisning, rådgivning eller annan tjänst',
            till: lov({
              id: 'tjanst',
              namn: 'Köpt tjänst',
              sokord: ['tjänst', 'konsult', 'rådgivning', 'redovisning', 'arvode'],
              riktning: 'utgift',
              konto: '6500',
              moms: fast(25),
              betalsatt: INKOP,
              kalla: MOMS_25,
            }),
          },
          {
            text: 'Reklam eller annonser',
            till: lov({
              id: 'reklam',
              namn: 'Reklam och annonser',
              sokord: ['reklam', 'annons', 'marknadsföring', 'hemsida'],
              riktning: 'utgift',
              konto: '5900',
              moms: fast(25),
              betalsatt: INKOP,
              kalla: MOMS_25,
            }),
          },
          {
            text: 'Frakt av varor',
            till: lov({
              id: 'frakt',
              namn: 'Frakt',
              sokord: ['frakt', 'leverans', 'postnord', 'schenker'],
              riktning: 'utgift',
              konto: '5700',
              moms: fast(25),
              betalsatt: INKOP,
              kalla: MOMS_25,
            }),
          },
        ],
      },
    },
    {
      text: 'Försäkring, bank, ränta och avgifter',
      till: {
        typ: 'fraga',
        id: 'avgifter',
        fraga: 'Vad gäller det?',
        svar: [
          {
            text: 'Försäkring för firman',
            till: lov({
              id: 'forsakring',
              namn: 'Företagsförsäkring',
              sokord: ['försäkring', 'lantbruksförsäkring', 'premie'],
              riktning: 'utgift',
              konto: '6310',
              moms: fast(0),
              betalsatt: INKOP,
              kalla: FORSAKRING,
            }),
          },
          {
            text: 'Bankavgift',
            till: lov({
              id: 'bankavgift',
              namn: 'Bankavgift',
              sokord: ['bankavgift', 'kontoavgift', 'kortavgift', 'swish'],
              riktning: 'utgift',
              konto: '6500',
              moms: fast(0),
              betalsatt: BANK,
              kalla: FINANSIELL,
            }),
          },
          {
            text: 'Ränta på lån',
            till: lov({
              id: 'rantekostnad',
              namn: 'Räntekostnad',
              sokord: ['ränta', 'räntekostnad'],
              riktning: 'utgift',
              konto: '8410',
              moms: fast(0),
              betalsatt: BANK,
              kalla: FINANSIELL,
            }),
          },
          {
            text: 'Medlemsavgift i en förening',
            till: lov({
              id: 'foreningsavgift',
              namn: 'Föreningsavgift',
              sokord: ['medlemsavgift', 'förening', 'avgift', 'lrf'],
              riktning: 'utgift',
              konto: '6980',
              moms: {
                typ: 'fraga',
                forval: 0,
                hjalp:
                  'En medlemsavgift är oftast utan moms. Står det moms på fakturan, välj den satsen.',
              },
              betalsatt: INKOP,
              kalla: BAS_K1,
            }),
          },
        ],
      },
    },
    {
      text: 'Resor',
      till: lov({
        id: 'resa',
        namn: 'Resa',
        sokord: ['tåg', 'buss', 'flyg', 'hotell', 'resa', 'biljett', 'parkering'],
        riktning: 'utgift',
        konto: '5800',
        moms: {
          typ: 'fraga',
          forval: 6,
          hjalp:
            'Tåg, buss och flyg inom Sverige har 6 % moms, hotell 12 % och parkering 25 %. Välj den sats som står på kvittot.',
        },
        betalsatt: INKOP,
        kalla: 'Mervärdesskattelagen (2023:200) 9 kap. ' + BAS_K1,
      }),
    },
    { text: 'Amortering på ett lån', till: AMORTERING },
    {
      text: 'Något annat',
      till: lov({
        id: 'ovrigt',
        namn: 'Övrig kostnad',
        sokord: ['övrigt', 'annat'],
        riktning: 'utgift',
        konto: '6900',
        moms: {
          typ: 'fraga',
          forval: 25,
          hjalp:
            'Välj den sats som står på kvittot. Konteringen kan ändras innan du bokför.',
        },
        betalsatt: INKOP,
        kalla: BAS_K1,
      }),
    },
  ],
};

const PENGAR_IN: Fraga = {
  typ: 'fraga',
  id: 'pengar-in',
  fraga: 'Vad har du fått betalt för?',
  svar: [
    {
      text: 'Sålt levande djur',
      till: lov({
        id: 'salt-djur',
        namn: 'Försäljning av djur',
        sokord: ['lamm', 'får', 'djur', 'avräkning', 'slakteri', 'livdjur'],
        riktning: 'inkomst',
        konto: '3000',
        moms: fast(25),
        betalsatt: INTAKT,
        ord: { belopp: 'Att få in', konto: 'Insatt på' },
        ledtext: 'Levande djur har 25 % moms, även när de säljs till slakt.',
        kalla:
          'Skatteverket: levande djur har 25 % moms och blir livsmedel först vid slakt. ' +
          BAS_K1,
      }),
    },
    {
      text: 'Sålt kött eller andra livsmedel',
      till: lov({
        id: 'salt-livsmedel',
        namn: 'Försäljning av livsmedel',
        sokord: ['kött', 'lammkött', 'chark', 'livsmedel', 'ägg'],
        riktning: 'inkomst',
        konto: '3000',
        moms: { typ: 'livsmedel' },
        betalsatt: INTAKT,
        ord: { belopp: 'Att få in', konto: 'Insatt på' },
        kalla: LIVSMEDEL,
      }),
    },
    {
      text: 'Sålt ull, skinn eller andra varor',
      till: lov({
        id: 'salt-varor',
        namn: 'Försäljning av varor',
        sokord: ['ull', 'skinn', 'fäll', 'försäljning'],
        riktning: 'inkomst',
        konto: '3000',
        moms: fast(25),
        betalsatt: INTAKT,
        ord: { belopp: 'Att få in', konto: 'Insatt på' },
        kalla: MOMS_25,
      }),
    },
    {
      text: 'Utfört arbete eller en tjänst',
      till: lov({
        id: 'salt-tjanst',
        namn: 'Försäljning av tjänst',
        sokord: ['arbete', 'tjänst', 'betesputs', 'faktura'],
        riktning: 'inkomst',
        konto: '3000',
        moms: fast(25),
        betalsatt: INTAKT,
        ord: { belopp: 'Att få in', konto: 'Insatt på' },
        kalla: MOMS_25,
      }),
    },
    {
      text: 'Sålt en maskin eller inventarie',
      till: lov({
        id: 'salt-inventarie',
        namn: 'Försäljning av maskin eller inventarie',
        sokord: ['maskin', 'traktor', 'inventarie', 'begagnad'],
        riktning: 'inkomst',
        konto: '1222',
        moms: fast(25),
        betalsatt: INTAKT,
        ord: { belopp: 'Att få in', konto: 'Insatt på' },
        ledtext: 'Markera den också som såld under Anläggningar.',
        kalla:
          'Mervärdesskattelagen (2023:200) 3 kap. 1 §: försäljningen är en leverans mot ersättning. ' +
          BAS_K1 +
          ': 1222 Årets ersättning för maskiner och inventarier',
      }),
    },
    {
      text: 'Stöd eller bidrag',
      till: lov({
        id: 'stod',
        namn: 'Stöd och bidrag',
        sokord: ['stöd', 'bidrag', 'gårdsstöd', 'miljöersättning', 'jordbruksverket'],
        riktning: 'inkomst',
        konto: '3980',
        moms: fast(0),
        betalsatt: BANK,
        ord: { belopp: 'Att få in', konto: 'Insatt på' },
        ledtext: 'Ett stöd är ingen betalning för något du sålt, och har ingen moms.',
        kalla:
          'Mervärdesskattelagen (2023:200) 3 kap. 1 §: moms tas ut på leveranser mot ersättning. ' +
          BAS_K1,
      }),
    },
    {
      text: 'Ersättning från försäkringen',
      till: lov({
        id: 'forsakr-ersatt',
        namn: 'Försäkringsersättning',
        sokord: ['försäkringsersättning', 'skadeersättning', 'ersättning'],
        riktning: 'inkomst',
        konto: '3900',
        moms: fast(0),
        betalsatt: BANK,
        ord: { belopp: 'Att få in', konto: 'Insatt på' },
        kalla: FORSAKRING,
      }),
    },
    {
      text: 'Ränta på kontot',
      till: lov({
        id: 'ranteintakt',
        namn: 'Ränteintäkt',
        sokord: ['ränta', 'ränteintäkt'],
        riktning: 'inkomst',
        konto: '8310',
        moms: fast(0),
        betalsatt: BANK,
        ord: { belopp: 'Att få in', konto: 'Insatt på' },
        kalla: FINANSIELL,
      }),
    },
    { text: 'Moms tillbaka från Skatteverket', till: MOMS_TILLBAKA },
    { text: 'Egna pengar in i firman', till: EGEN_INSATTNING },
    { text: 'Ett lån', till: NYTT_LAN },
  ],
};

const FLYTTA_PENGAR: Fraga = {
  typ: 'fraga',
  id: 'flytta-pengar',
  fraga: 'Vart flyttar du pengar?',
  hjalp: 'Pengar som byter plats är varken en kostnad eller en intäkt.',
  svar: [
    {
      text: 'Från firman till mig själv',
      till: lov({
        id: 'eget-uttag',
        namn: 'Eget uttag',
        sokord: ['uttag', 'privat', 'lön'],
        riktning: 'utgift',
        konto: '2013',
        moms: fast(0),
        betalsatt: [K('1930'), K('1910')],
        ord: { belopp: 'Belopp', konto: 'Taget från' },
        ledtext:
          'En enskild firma har ingen lön till ägaren. Det du tar ut är ett eget uttag.',
        kalla: INGEN_OMSATTNING,
      }),
    },
    { text: 'Från mig själv till firman', till: EGEN_INSATTNING },
    {
      text: 'Från företagskontot till kassan',
      till: lov({
        id: 'till-kassan',
        namn: 'Kontanter till kassan',
        sokord: ['kontanter', 'kassa', 'bankomat'],
        riktning: 'utgift',
        konto: '1910',
        moms: fast(0),
        betalsatt: BANK,
        ord: { belopp: 'Belopp', konto: 'Taget från' },
        kalla: INGEN_OMSATTNING,
      }),
    },
    {
      text: 'Från kassan till företagskontot',
      till: lov({
        id: 'fran-kassan',
        namn: 'Kassan in på banken',
        sokord: ['kontanter', 'kassa', 'insättning'],
        riktning: 'inkomst',
        konto: '1910',
        moms: fast(0),
        betalsatt: BANK,
        ord: { belopp: 'Belopp', konto: 'Insatt på' },
        kalla: INGEN_OMSATTNING,
      }),
    },
    {
      text: 'Till skattekontot',
      till: lov({
        id: 'till-skatt',
        namn: 'Insättning på skattekontot',
        sokord: ['skattekonto', 'skatteverket', 'inbetalning'],
        riktning: 'utgift',
        konto: '2012',
        moms: fast(0),
        betalsatt: [K('1930'), K('2017')],
        ord: { belopp: 'Belopp', konto: 'Betalat från' },
        kalla: BAS_K1 + ': 2012 Avräkning för skatter och avgifter (skattekonto)',
      }),
    },
    {
      text: 'Från skattekontot',
      till: lov({
        id: 'fran-skatt',
        namn: 'Utbetalning från skattekontot',
        sokord: ['skattekonto', 'skatteverket', 'utbetalning'],
        riktning: 'inkomst',
        konto: '2012',
        moms: fast(0),
        betalsatt: [K('1930'), K('2013')],
        ord: { belopp: 'Belopp', konto: 'Insatt på' },
        kalla: BAS_K1 + ': 2012 Avräkning för skatter och avgifter (skattekonto)',
      }),
    },
    {
      text: 'Skatten som dragits på skattekontot',
      till: lov({
        id: 'f-skatt',
        namn: 'Preliminärskatt från skattekontot',
        sokord: ['f-skatt', 'preliminärskatt', 'egenavgifter', 'skatt'],
        riktning: 'utgift',
        konto: '2013',
        moms: fast(0),
        betalsatt: [K('2012')],
        ord: { belopp: 'Belopp', konto: 'Dragen från' },
        ledtext:
          'Din F-skatt och egenavgifter i en enskild firma är privata och bokförs som eget uttag. Momsen bokförs för sig under Moms.',
        kalla: BAS_K1 + ': 2012 skattekontot, 2013 Övriga egna uttag',
      }),
    },
    { text: 'Amortering på ett lån', till: AMORTERING },
  ],
};

/** Where every booking starts. */
export const BESLUTSTRAD: Fraga = {
  typ: 'fraga',
  id: 'start',
  fraga: 'Vad har hänt?',
  svar: [
    { text: 'Pengar ut', till: PENGAR_UT },
    { text: 'Pengar in', till: PENGAR_IN },
    { text: 'Flytta pengar', till: FLYTTA_PENGAR },
    {
      text: 'Moms',
      till: {
        typ: 'fraga',
        id: 'moms',
        fraga: 'Vad gäller momsen?',
        svar: [
          { text: 'Räkna fram och bokföra momsen för en period', till: MOMSREDOVISNING },
          { text: 'Betalat moms', till: MOMS_BETALD },
          { text: 'Fått tillbaka moms', till: MOMS_TILLBAKA },
        ],
      },
    },
    {
      text: 'Vid årets slut',
      till: {
        typ: 'fraga',
        id: 'arets-slut',
        fraga: 'Vad ska göras?',
        svar: [
          {
            text: 'Räkna lagret',
            till: {
              typ: 'hanvisning',
              id: 'lager',
              till: 'lager',
              text: 'Lagret räknas och bokförs under Lager.',
            },
          },
          {
            text: 'Obetalda fakturor och annat som inte betalats',
            till: {
              typ: 'hanvisning',
              id: 'periodisering',
              till: 'periodisering',
              text: 'Det tas upp under Obetalda fakturor och periodisering.',
            },
          },
          {
            text: 'Skriva av maskiner och inventarier',
            till: {
              typ: 'hanvisning',
              id: 'avskrivning',
              till: 'anlaggning',
              text: 'Avskrivningarna räknas fram och bokförs under Anläggningar.',
            },
          },
        ],
      },
    },
  ],
};

/** The first day of the temporary 6 % on food, and the last. */
const LIVSMEDEL_SANKT_FRAN = '2026-04-01';
const LIVSMEDEL_SANKT_TILL = '2027-12-31';

export interface Momsforslag {
  readonly sats: Momssats;
  /** Whether the form should let the rate be chosen. */
  readonly valbar: boolean;
  readonly hjalp?: string;
}

/**
 * The moms a leaf proposes on a given date.
 *
 * Food is the one rate that moves with the date: 12 % until 31 March 2026,
 * then a temporary 6 % through 2027 (mervärdesskattelagen 9 kap. 19 §;
 * Skatteverket, "Livsmedelsmomsen sänks till 6 procent", 2026). After that
 * the app does not know what will apply, and says so instead of guessing.
 */
export function momsForLov(lov: Lov, datum: Datum): Momsforslag {
  switch (lov.moms.typ) {
    case 'fast':
      return { sats: lov.moms.sats, valbar: false };
    case 'fraga':
      return { sats: lov.moms.forval, valbar: true, hjalp: lov.moms.hjalp };
    case 'livsmedel':
      if (datum < LIVSMEDEL_SANKT_FRAN) {
        return {
          sats: 12,
          valbar: false,
          hjalp: 'Livsmedel har 12 % moms före 1 april 2026.',
        };
      }
      if (datum <= LIVSMEDEL_SANKT_TILL) {
        return {
          sats: 6,
          valbar: false,
          hjalp:
            'Livsmedel har tillfälligt 6 % moms från 1 april 2026 till och med 2027.',
        };
      }
      return {
        sats: 12,
        valbar: true,
        hjalp:
          'Den tillfälliga sänkningen till 6 % gällde till och med 2027. Kontrollera vilken sats som gäller nu.',
      };
  }
}

/**
 * The leaf as a template, so the existing arithmetic books it.
 *
 * tillampaMall already splits moms, handles öresutjämning and the moms a
 * receipt states; the tree only decides what goes into it.
 */
export function lovTillMall(lov: Lov, momssats: Momssats): Konteringsmall {
  const momskonto = forvaltMomskonto(lov.riktning, momssats);
  return {
    id: lovMallId(lov.id),
    namn: lov.namn,
    sokord: lov.sokord,
    riktning: lov.riktning,
    konto: lov.konto,
    momssats,
    ...(momskonto === undefined ? {} : { momskonto }),
  };
}

/**
 * The identifier a verifikat booked from this leaf carries.
 *
 * Derived from the leaf's id rather than generated, so that every device
 * gives the same leaf the same identifier and use can be counted across
 * them. The id's ASCII bytes fill the UUID's free positions; version and
 * variant are fixed at 7 and 8 so the result reads as any other identifier.
 */
export function lovMallId(id: string): Uuid {
  if (!/^[a-z0-9-]{1,15}$/.test(id)) {
    throw new RangeError(
      `Ett löv-id är 1-15 tecken a-z, 0-9 eller bindestreck, fick "${id}".`,
    );
  }
  const hex = [...id]
    .map((tecken) => tecken.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .padEnd(30, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(12, 15)}-8${hex.slice(15, 18)}-${hex.slice(18, 30)}` as Uuid;
}

/** Every leaf once, in the order the tree shows them. */
export function allaLov(rot: Fraga = BESLUTSTRAD): Lov[] {
  const funna = new Map<string, Lov>();
  const besok = (nod: Nod) => {
    if (nod.typ === 'lov') {
      if (!funna.has(nod.id)) {
        funna.set(nod.id, nod);
      }
    } else if (nod.typ === 'fraga') {
      nod.svar.forEach((svar) => besok(svar.till));
    }
  };
  besok(rot);
  return [...funna.values()];
}

/** The leaf a verifikat's mall id came from, if it came from one. */
export function lovForMallId(mallId: Uuid, rot: Fraga = BESLUTSTRAD): Lov | undefined {
  return allaLov(rot).find((lov) => lovMallId(lov.id) === mallId);
}

/**
 * The answers that lead to a leaf, for showing where a search result sits:
 * "Pengar ut › Djuren". The first way there when there are several.
 */
export function stigTill(lovId: string, rot: Fraga = BESLUTSTRAD): string[] | undefined {
  const sok = (nod: Fraga, stig: string[]): string[] | undefined => {
    for (const svar of nod.svar) {
      if (svar.till.typ === 'lov' && svar.till.id === lovId) {
        return stig;
      }
      if (svar.till.typ === 'fraga') {
        const hittad = sok(svar.till, [...stig, svar.text]);
        if (hittad !== undefined) {
          return hittad;
        }
      }
    }
    return undefined;
  };
  return sok(rot, []);
}

/** Every account the tree books on, payment accounts included. */
export function kontonITradet(rot: Fraga = BESLUTSTRAD): Set<Kontonummer> {
  const konton = new Set<Kontonummer>();
  for (const lov of allaLov(rot)) {
    konton.add(lov.konto);
    lov.betalsatt.forEach((konto) => konton.add(konto));
    for (const sats of [0, 6, 12, 25] as const) {
      const momskonto = forvaltMomskonto(lov.riktning, sats);
      if (momskonto !== undefined) {
        konton.add(momskonto);
      }
    }
  }
  return konton;
}
