import { kontonummer, type Kontonummer } from '../konto/konto';
import { fast, lov, type Fraga, type Hanvisning } from './beslutstrad';

/**
 * Booking by answering questions, for an ideell förening.
 *
 * The association's counterpart of {@link BESLUTSTRAD}: the same leaves and the
 * same arithmetic, with the association's questions and accounts. It books for
 * an association that is **not registered for moms**: the moms on a purchase
 * is part of the cost, because only deductible moms is left out of an
 * utgift (BFNAR 2010:1 punkt 2.4 and 7.12 a), and no leaf splits any off. A
 * registered association gets no tree of its own yet - it books by hand under
 * Fri kontering - since the moms of a mixed activity has to be divided, and
 * that is not worked out here.
 *
 * The accounts are the association starter set's (FORENINGENS_GRUNDKONTON in
 * src/data/uppstart.ts), and `foreningstrad.test.ts` checks that every one of
 * them is in it. Leaf identifiers begin with "f-" so that they never collide
 * with a firm's: they become the verifikat's mall id and are stable for ever.
 */

const K = kontonummer;

/** Where the money can come from or go: the bank, the cash box, the placeringskonto. */
const KONTON: readonly Kontonummer[] = [K('1930'), K('1910'), K('1940')];
const BANK: readonly Kontonummer[] = [K('1930')];

const BFNAR = 'BFNAR 2010:1';
const UTAN_AVDRAG =
  `${BFNAR} punkt 7.12 a: en utgift är utbetalningen exklusive avdragsgill moms. ` +
  'En förening som inte är momsregistrerad har ingen avdragsgill moms, så hela beloppet är kostnaden.';
const MEDLEMSAVGIFT = `${BFNAR} punkt 3.6 och 7.1: en medlemsavgift är en intäkt när den betalas. Momsfri enligt Skatteverket.`;
const GAVA = `${BFNAR} punkt 3.6 och 7.2: en gåva i pengar är en intäkt till det belopp som betalats.`;
const BIDRAG = `${BFNAR} punkt 2.1, 3.6 och 7.3: ett bidrag från ett offentligrättsligt organ är en intäkt till beloppet i beslutet. Bidrag är momsfria enligt Skatteverket.`;
const FORSALJNING = `${BFNAR} punkt 3.6 och 7.6: en försäljningsintäkt är beloppet på kvittot eller fakturan.`;
const OVRIG_INTAKT = `${BFNAR} punkt 3.6 och 7.5: ersättning för att delta i eller utnyttja föreningens verksamhet är en intäkt till beloppet på kvittot eller fakturan.`;
const INGEN_INKOMST = `${BFNAR} punkt 3.5: inkomst är bara det föreningen tar emot för egen räkning. Att flytta egna pengar eller ta emot ett lån är ingen intäkt.`;

const ORD_IN = { belopp: 'Att få in', konto: 'Insatt på' } as const;
const ORD_UT = { belopp: 'Belopp', konto: 'Betalat från' } as const;

/** A cost on one account, with the moms inside it. */
function kostnad(
  id: string,
  namn: string,
  konto: string,
  sokord: readonly string[],
  ledtext?: string,
): Fraga['svar'][number] {
  return {
    text: namn,
    till: lov({
      id,
      namn,
      sokord,
      riktning: 'utgift',
      konto,
      moms: fast(0),
      betalsatt: KONTON,
      ...(ledtext === undefined ? {} : { ledtext }),
      kalla: UTAN_AVDRAG,
    }),
  };
}

const TILL_ANLAGGNING: Hanvisning = {
  typ: 'hanvisning',
  id: 'f-anlaggning',
  till: 'anlaggning',
  text:
    'En inventarie över ett halvt prisbasbelopp som håller längre än tre år tas upp som tillgång och skrivs av. ' +
    'Den läggs in under Anläggningar, och betalningen bokförs med Fri kontering.',
};

const PENGAR_UT: Fraga = {
  typ: 'fraga',
  id: 'f-ut',
  fraga: 'Vad har föreningen betalat för?',
  hjalp:
    'Har en medlem lagt ut pengarna? Bokför när föreningen betalar tillbaka, med den dagen som datum ' +
    'och kvittot som underlag. Betalat från: den kassa eller det konto pengarna kom ifrån.',
  svar: [
    {
      text: 'Fastigheten',
      till: {
        typ: 'fraga',
        id: 'f-fastighet',
        fraga: 'Vad gäller det?',
        svar: [
          kostnad('f-el', 'El', '5020', ['el', 'elräkning', 'ström']),
          kostnad('f-varme', 'Värme', '5030', ['värme', 'fjärrvärme', 'pellets', 'olja']),
          kostnad('f-vatten', 'Vatten och avlopp', '5050', ['vatten', 'avlopp', 'va']),
          kostnad('f-sopor', 'Sophämtning', '5060', [
            'sopor',
            'sophämtning',
            'renhållning',
          ]),
          kostnad('f-bredband', 'Bredband', '5040', ['bredband', 'fiber', 'internet']),
          kostnad(
            'f-repar',
            'Reparation och underhåll',
            '5070',
            ['reparation', 'underhåll', 'målning', 'hantverkare'],
            'En ombyggnad eller tillbyggnad räknas som en tillgång och hör inte hit. Lägg in den under Anläggningar.',
          ),
          kostnad('f-skotsel', 'Fastighetsskötsel', '5193', [
            'städning',
            'gräsklippning',
            'snöröjning',
            'skötsel',
          ]),
        ],
      },
    },
    {
      text: 'Kontor, telefon och post',
      till: {
        typ: 'fraga',
        id: 'f-kontor',
        fraga: 'Vad gäller det?',
        svar: [
          kostnad('f-kontorsmat', 'Kontorsmaterial', '6110', [
            'papper',
            'kontor',
            'pennor',
          ]),
          kostnad('f-tryck', 'Trycksaker', '6150', [
            'tryck',
            'affisch',
            'flygblad',
            'kopiering',
          ]),
          kostnad('f-tele', 'Telefon och internet', '6230', [
            'telefon',
            'mobil',
            'abonnemang',
          ]),
          kostnad('f-porto', 'Porto', '6250', ['porto', 'frimärken', 'post']),
        ],
      },
    },
    {
      text: 'Inventarier och material',
      till: {
        typ: 'fraga',
        id: 'f-inv',
        fraga:
          'Kostar den mer än ett halvt prisbasbelopp med moms, och håller den längre än tre år?',
        hjalp:
          'Saker som köps tillsammans och hör ihop räknas som en. Är svaret nej på någon av frågorna blir det en vanlig kostnad direkt.',
        visaHalvtPrisbasbelopp: true,
        svar: [
          { text: 'Ja, båda', till: TILL_ANLAGGNING },
          {
            text: 'Nej',
            till: lov({
              id: 'f-smainv',
              namn: 'Mindre inventarier och material',
              sokord: ['inventarie', 'verktyg', 'möbler', 'material', 'förbrukning'],
              riktning: 'utgift',
              konto: '5410',
              moms: fast(0),
              betalsatt: KONTON,
              kalla:
                `${BFNAR} punkt 6.27 och 6.28: en inventarie under ett halvt prisbasbelopp ` +
                '(med moms som inte dras av), eller med en livslängd på högst tre år, får kostnadsföras direkt. ' +
                UTAN_AVDRAG,
            }),
          },
        ],
      },
    },
    kostnad('f-varor', 'Varor att sälja, och vinster', '4010', [
      'fika',
      'kaffe',
      'vinster',
      'lotteri',
      'varor',
      'inköp',
    ]),
    kostnad('f-forsakring', 'Försäkring', '6310', ['försäkring', 'fastighetsförsäkring']),
    kostnad('f-bankavgift', 'Bankavgift', '6570', ['bank', 'avgift', 'swish']),
    kostnad('f-ranta', 'Räntekostnad', '8400', ['ränta', 'räntekostnad', 'lånekostnad']),
    kostnad(
      'f-orgavgift',
      'Avgift till en organisation',
      '6320',
      ['medlemsavgift', 'riksförbund', 'distrikt', 'serviceavgift'],
      'Det föreningen själv betalar för sitt medlemskap, till exempel i en riksorganisation.',
    ),
    kostnad('f-frakt', 'Frakt', '5700', ['frakt', 'transport', 'leverans']),
    {
      text: 'Amortering på lån',
      till: lov({
        id: 'f-amortering',
        namn: 'Amortering på lån',
        sokord: ['amortering', 'avbetalning', 'lån'],
        riktning: 'utgift',
        konto: '2399',
        moms: fast(0),
        betalsatt: BANK,
        ord: ORD_UT,
        ledtext: 'Bara amorteringen. Räntan bokförs för sig, som Räntekostnad.',
        kalla: INGEN_INKOMST,
      }),
    },
    {
      text: 'Lämnat tillbaka en deposition',
      till: lov({
        id: 'f-depaterb',
        namn: 'Deposition tillbaka',
        sokord: ['deposition', 'depositionsavgift', 'tillbaka'],
        riktning: 'utgift',
        konto: '2900',
        moms: fast(0),
        betalsatt: BANK,
        ord: ORD_UT,
        ledtext: 'En deposition är en skuld som lämnas tillbaka, inte en kostnad.',
        kalla: INGEN_INKOMST,
      }),
    },
    kostnad('f-ovrigt', 'Övrig kostnad', '6390', ['övrigt', 'diverse', 'annat']),
  ],
};

const BIDRAG_TRAD: Fraga = {
  typ: 'fraga',
  id: 'f-bidrag',
  fraga: 'Vilket bidrag är det?',
  hjalp:
    'Bidraget tas som intäkt när det betalas. Hör det till ett annat år, eller är det beslutat men inte utbetalt vid årets slut, tas det upp under Obetalda fakturor och periodisering.',
  svar: [
    {
      text: 'Från kommun, stat eller annat offentligt organ',
      till: lov({
        id: 'f-bidrag-off',
        namn: 'Bidrag från kommun eller stat',
        sokord: ['bidrag', 'kommun', 'stat', 'region', 'statsbidrag'],
        riktning: 'inkomst',
        konto: '3710',
        moms: fast(0),
        betalsatt: KONTON,
        ord: ORD_IN,
        kalla: BIDRAG,
      }),
    },
    {
      text: 'Från EU',
      till: lov({
        id: 'f-bidrag-eu',
        namn: 'Bidrag från EU',
        sokord: ['bidrag', 'eu', 'leader', 'jordbruksverket'],
        riktning: 'inkomst',
        konto: '3730',
        moms: fast(0),
        betalsatt: KONTON,
        ord: ORD_IN,
        kalla: BIDRAG,
      }),
    },
    {
      text: 'Ett bidrag som kan krävas tillbaka',
      till: lov({
        id: 'f-bidrag-vill',
        namn: 'Villkorat bidrag',
        sokord: ['villkorat', 'återbetalning', 'bidrag'],
        riktning: 'inkomst',
        konto: '2900',
        moms: fast(0),
        betalsatt: KONTON,
        ord: ORD_IN,
        ledtext:
          'Ett bidrag med krav på återbetalning om villkoren inte uppfylls tas upp som en skuld när det betalas ut. ' +
          'Det blir en intäkt först när det med hög sannolikhet inte kommer att krävas tillbaka.',
        kalla: `${BFNAR} punkt 2.2, 6.77 och 7.4.`,
      }),
    },
    {
      text: 'Till en byggnad eller en inventarie',
      till: {
        typ: 'hanvisning',
        id: 'f-bidrag-inv',
        till: 'anlaggning',
        text:
          'Ett bidrag som hör till köpet av en byggnad, mark eller en inventarie minskar tillgångens anskaffningsvärde ' +
          'och är ingen intäkt (BFNAR 2010:1 punkt 6.12, 6.22 och 6.33). Lägg in tillgången under Anläggningar ' +
          'med det nedsatta värdet, och bokför bidraget med Fri kontering.',
      },
    },
  ],
};

const PENGAR_IN: Fraga = {
  typ: 'fraga',
  id: 'f-in',
  fraga: 'Vad har föreningen fått betalt för?',
  svar: [
    {
      text: 'Medlemsavgift',
      till: lov({
        id: 'f-medlem',
        namn: 'Medlemsavgift',
        sokord: ['medlem', 'medlemsavgift', 'medlemskap', 'årsavgift'],
        riktning: 'inkomst',
        konto: '3610',
        moms: fast(0),
        betalsatt: KONTON,
        ord: ORD_IN,
        kalla: MEDLEMSAVGIFT,
      }),
    },
    { text: 'Bidrag', till: BIDRAG_TRAD },
    {
      text: 'Gåva eller privat bidrag',
      till: lov({
        id: 'f-gava',
        namn: 'Gåva eller privat bidrag',
        sokord: ['gåva', 'donation', 'sponsor', 'privat bidrag', 'skänkt'],
        riktning: 'inkomst',
        konto: '3720',
        moms: fast(0),
        betalsatt: KONTON,
        ord: ORD_IN,
        ledtext:
          'Bara pengar. En arbetsinsats bokförs inte (BFNAR 2010:1 punkt 3.3). ' +
          'En gåva i varor eller tillgångar ska värderas och bokförs med Fri kontering.',
        kalla: GAVA,
      }),
    },
    {
      text: 'Uthyrning av lokalen',
      till: lov({
        id: 'f-hyra',
        namn: 'Hyra av lokal',
        sokord: ['hyra', 'uthyrning', 'lokal', 'bygdegård', 'fest'],
        riktning: 'inkomst',
        konto: '3811',
        moms: fast(0),
        betalsatt: KONTON,
        ord: ORD_IN,
        ledtext:
          'Uthyrning av en lokal är momsfri om föreningen inte har valt frivillig skattskyldighet. ' +
          'Ett förskott på mer än 5 000 kr för en hyra som ännu inte har börjat ska tas upp som skuld under Obetalda fakturor och periodisering (punkt 6.73).',
        kalla: `${OVRIG_INTAKT} Skatteverket: uthyrning av lokal är momsfri om föreningen inte har valt frivillig skattskyldighet.`,
      }),
    },
    {
      text: 'Lotter',
      till: lov({
        id: 'f-lotter',
        namn: 'Försäljning av lotter',
        sokord: ['lotter', 'lotteri', 'tombola', 'lott'],
        riktning: 'inkomst',
        konto: '3320',
        moms: fast(0),
        betalsatt: KONTON,
        ord: ORD_IN,
        ledtext: 'Vinsterna bokförs för sig, som Varor att sälja, och vinster.',
        kalla: `${FORSALJNING} Lotter är momsfria enligt Skatteverket.`,
      }),
    },
    {
      text: 'Försäljning av varor eller fika',
      till: lov({
        id: 'f-forsalj',
        namn: 'Försäljning',
        sokord: ['försäljning', 'fika', 'kaffe', 'bakverk', 'loppis', 'kiosk'],
        riktning: 'inkomst',
        konto: '3010',
        moms: fast(0),
        betalsatt: KONTON,
        ord: ORD_IN,
        kalla: FORSALJNING,
      }),
    },
    {
      text: 'Deltagaravgift eller annan intäkt',
      till: lov({
        id: 'f-deltagar',
        namn: 'Deltagaravgift och övriga intäkter',
        sokord: ['deltagaravgift', 'entré', 'kursavgift', 'avgift', 'arrangemang'],
        riktning: 'inkomst',
        konto: '3990',
        moms: fast(0),
        betalsatt: KONTON,
        ord: ORD_IN,
        kalla: OVRIG_INTAKT,
      }),
    },
    {
      text: 'Försäkringsersättning eller skadestånd',
      till: lov({
        id: 'f-ersattning',
        namn: 'Försäkringsersättning eller skadestånd',
        sokord: ['försäkring', 'skadestånd', 'ersättning', 'skada'],
        riktning: 'inkomst',
        konto: '3990',
        moms: fast(0),
        betalsatt: KONTON,
        ord: ORD_IN,
        kalla: `${BFNAR} punkt 3.6 och 7.7: en intäkt när medlen kan disponeras.`,
      }),
    },
    {
      text: 'Ränta på banken',
      till: lov({
        id: 'f-rantaint',
        namn: 'Ränteintäkt',
        sokord: ['ränta', 'sparkonto', 'bankränta'],
        riktning: 'inkomst',
        konto: '8300',
        moms: fast(0),
        betalsatt: KONTON,
        ord: ORD_IN,
        kalla: `${BFNAR} punkt 3.6 och 7.9: en ränteintäkt är beloppet på räntebeskedet.`,
      }),
    },
    {
      text: 'Ett nytt lån',
      till: lov({
        id: 'f-nyttlan',
        namn: 'Nytt lån',
        sokord: ['lån', 'kredit', 'banklån'],
        riktning: 'inkomst',
        konto: '2399',
        moms: fast(0),
        betalsatt: BANK,
        ord: { belopp: 'Lånebelopp', konto: 'Insatt på' },
        kalla: INGEN_INKOMST,
      }),
    },
    {
      text: 'En deposition som ska lämnas tillbaka',
      till: lov({
        id: 'f-deposition',
        namn: 'Deposition',
        sokord: ['deposition', 'handpenning', 'depositionsavgift'],
        riktning: 'inkomst',
        konto: '2900',
        moms: fast(0),
        betalsatt: KONTON,
        ord: ORD_IN,
        ledtext:
          'En deposition lämnas tillbaka och är en skuld, inte en intäkt. Behålls den, tas den upp som intäkt för sig.',
        kalla: INGEN_INKOMST,
      }),
    },
  ],
};

const FLYTTA_PENGAR: Fraga = {
  typ: 'fraga',
  id: 'f-flytta',
  fraga: 'Vart flyttar föreningen pengar?',
  hjalp: 'Pengar som byter plats är varken en kostnad eller en intäkt.',
  svar: [
    {
      text: 'Från banken till kassan',
      till: lov({
        id: 'f-tillkassan',
        namn: 'Kontanter till kassan',
        sokord: ['kontanter', 'kassa', 'bankomat'],
        riktning: 'utgift',
        konto: '1910',
        moms: fast(0),
        betalsatt: BANK,
        ord: { belopp: 'Belopp', konto: 'Taget från' },
        kalla: INGEN_INKOMST,
      }),
    },
    {
      text: 'Från kassan till banken',
      till: lov({
        id: 'f-frankassan',
        namn: 'Kassan in på banken',
        sokord: ['kontanter', 'kassa', 'insättning'],
        riktning: 'inkomst',
        konto: '1910',
        moms: fast(0),
        betalsatt: BANK,
        ord: { belopp: 'Belopp', konto: 'Insatt på' },
        kalla: INGEN_INKOMST,
      }),
    },
    {
      text: 'Från banken till placeringskontot',
      till: lov({
        id: 'f-tillplac',
        namn: 'Till placeringskontot',
        sokord: ['placering', 'sparkonto', 'sparande'],
        riktning: 'utgift',
        konto: '1940',
        moms: fast(0),
        betalsatt: BANK,
        ord: { belopp: 'Belopp', konto: 'Taget från' },
        kalla: INGEN_INKOMST,
      }),
    },
    {
      text: 'Från placeringskontot till banken',
      till: lov({
        id: 'f-franplac',
        namn: 'Från placeringskontot',
        sokord: ['placering', 'sparkonto', 'uttag'],
        riktning: 'inkomst',
        konto: '1940',
        moms: fast(0),
        betalsatt: BANK,
        ord: { belopp: 'Belopp', konto: 'Insatt på' },
        kalla: INGEN_INKOMST,
      }),
    },
  ],
};

/** Where every booking in an association's book starts. */
export const FORENINGSTRAD: Fraga = {
  typ: 'fraga',
  id: 'f-start',
  fraga: 'Vad har hänt?',
  svar: [
    { text: 'Pengar ut', till: PENGAR_UT },
    { text: 'Pengar in', till: PENGAR_IN },
    { text: 'Flytta pengar', till: FLYTTA_PENGAR },
    {
      text: 'Vid årets slut',
      till: {
        typ: 'fraga',
        id: 'f-arets-slut',
        fraga: 'Vad ska göras?',
        svar: [
          {
            text: 'Obetalda fakturor, bidrag och annat som inte betalats',
            till: {
              typ: 'hanvisning',
              id: 'f-periodisering',
              till: 'periodisering',
              text: 'Det tas upp under Obetalda fakturor och periodisering.',
            },
          },
          {
            text: 'Skriva av inventarier och byggnad',
            till: {
              typ: 'hanvisning',
              id: 'f-avskrivning',
              till: 'anlaggning',
              text: 'Avskrivningarna räknas fram och bokförs under Anläggningar.',
            },
          },
          {
            text: 'Reservera medel för ett ändamål',
            till: {
              typ: 'hanvisning',
              id: 'f-reservering',
              till: 'egetkapital',
              text: 'Medel sätts av, eller frigörs, under Eget kapital.',
            },
          },
        ],
      },
    },
  ],
};
