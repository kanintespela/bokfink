import { oreFromKronor, type Ore } from '../belopp/ore';
import { datumAv, type Datum } from '../tid/datum';

/**
 * Reading a receipt's text into a suggestion.
 *
 * Everything here is a guess offered to a person, never a booking: hard rule
 * 10 makes OCR fill in a form that someone approves. That is also why every
 * field is optional and nothing is invented - a field left out costs one
 * moment of typing, while a field filled in wrongly costs a wrong entry that
 * nobody looks at twice.
 *
 * The text comes from OCR, so it is dirty: missing characters, `O` for `0`,
 * lines out of order. The patterns are therefore deliberately loose about
 * spacing and case, and deliberately strict about what counts as a hit.
 */
export interface Kvittoforslag {
  readonly datum?: Datum;
  /** What was paid, VAT included. */
  readonly brutto?: Ore;
  readonly moms?: Ore;
  /** Whole percent, when the receipt states it. */
  readonly momssats?: number;
  readonly leverantor?: string;
  readonly orgnr?: string;
  /**
   * How many times the suggested total appears on the receipt.
   *
   * A receipt prints what was paid several times over - under Totalt, beside
   * the card, in the terminal's summary - so a figure that appears once on a
   * page full of numbers is a guess, and one that appears three times is a
   * reading. It is the only measure of a suggestion's strength that does not
   * depend on the engine's own opinion of itself.
   */
  readonly stod?: number;
}

/**
 * Labels that stand in front of the amount actually paid, strongest first.
 *
 * The tiers matter on an invoice, which labels four different figures. "Att
 * betala" says what it means and nothing else does; "Summa" is used for the
 * line total, the net and the amount due on the same page, so it only counts
 * when nothing stronger is there.
 *
 * Accent-folded and lower-cased before matching, so "ATT BETALA" and "Att
 * betala" are the same thing.
 */
const TOTALORD: readonly (readonly string[])[] = [
  ['att betala', 'att erlagga', 'totalt att betala', 'summa att betala'],
  /*
   * "Totalt" is a tier of its own, above "Summa". Both a shop receipt and an
   * invoice use it for the figure that was actually paid, while "Summa" is
   * used for a line total, a subtotal and the amount due indiscriminately on
   * the same page.
   */
  ['totalt', 'total', 'totalsumma'],
  /*
   * "Belopp" is not here. On a receipt it is nearly always a column heading -
   * PRODUKT, MOMS, BELOPP - and taking it for a total made a fuel receipt
   * suggest the figure under the wrong column. "Totalt belopp" still matches
   * through "totalt".
   */
  ['summa', 'brutto'],
];

/**
 * Words that turn a total label into something else.
 *
 * "Summa exkl. moms" is the net, "Summa moms" is the VAT, and öresavrundning
 * is neither. "Totalt inkl. moms" is the total, which is why "inkl" pardons a
 * line that mentions moms.
 */
const INTE_TOTALORD = ['exkl', 'exklusive', 'netto', 'avrundning', 'oresutjamning'];

/**
 * Labels that carry an amount which is not the total.
 *
 * Cash tendered is larger than the total, and change is what came back. A
 * receipt paid with a 500 note for a 320 kronor purchase would otherwise
 * suggest 500.
 */
const INTE_TOTAL = ['kontant', 'vaxel', 'mottaget', 'tillbaka', 'dricks'];

/**
 * How many digits an amount may have before the decimal point.
 *
 * The bug this exists for: a payment slip's OCR reference, printed in groups
 * of three, read as 740 508 293 901,00 kronor and offered as the amount to
 * book. Bankgiro numbers, organisation numbers, invoice numbers and reference
 * numbers are all long runs of digits, and none of them is money. Eight
 * digits leaves room for a hundred million kronor.
 */
const MAX_HELTALSSIFFROR = 8;

/**
 * The shortest word that makes a line look like a name rather than noise.
 *
 * "HR Rn" is what OCR made of a shop's logo; "Hästsport" is a name.
 */
const MINSTA_NAMNORD = 4;

/**
 * How far a figure may stand from its heading and still be under it.
 *
 * Columns are counted in characters, which is an approximation twice over:
 * the text has been folded for matching, and a proportional font only lines
 * up roughly when it is laid out as text at all. Ten characters is wide
 * enough to survive both and narrow enough to tell five columns apart.
 */
const KOLUMNGLAPP = 10;

/** How far below a label an amount may stand and still belong to it. */
const RADER_UNDER_ETIKETT = 2;

/** An amount as a receipt prints it: 1 234,56 or 1234.56 or 320. */
const BELOPP =
  /(?<![\d,.])(\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,](\d{2}))?(?![\d])/g;

const ISO_DATUM = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/;
const SVENSKT_DATUM = /\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/;
/** 260905, which cash registers still print. */
const KORT_DATUM = /\b(\d{2})(\d{2})(\d{2})\b/;

const ORGNR = /\b(\d{6})-?(\d{4})\b/;

const MOMSRAD =
  /moms[^\d%]{0,12}(\d{1,2})(?:[.,]\d{1,2})?\s*%|(\d{1,2})(?:[.,]\d{1,2})?\s*%[^\d]{0,12}moms/;

/**
 * Reads what can be read out of a receipt's text.
 *
 * `idag` is passed in rather than looked up, because the domain does not read
 * a clock (hard rule 3) - and it is needed: a receipt dated in the future is
 * a misread, and knowing today is what makes that visible.
 */
export function tolkaKvitto(text: string, idag: Datum): Kvittoforslag {
  const rader = text
    .split(/\r?\n/)
    .map((rad) => rad.trim())
    .filter((rad) => rad.length > 0);

  const forslag: {
    datum?: Datum;
    brutto?: Ore;
    moms?: Ore;
    momssats?: number;
    leverantor?: string;
    orgnr?: string;
    stod?: number;
  } = {};

  const hittatDatum = hittaDatum(rader, idag);
  if (hittatDatum !== undefined) {
    forslag.datum = hittatDatum;
  }

  const total = hittaTotal(rader);
  if (total !== undefined) {
    forslag.brutto = total.belopp;
    forslag.stod = total.stod;
  }

  const moms = hittaMoms(rader, total);
  if (moms?.belopp !== undefined) {
    forslag.moms = moms.belopp;
  }
  if (moms?.sats !== undefined) {
    forslag.momssats = moms.sats;
  }

  const leverantor = hittaLeverantor(rader);
  if (leverantor !== undefined) {
    forslag.leverantor = leverantor;
  }

  const orgnr = hittaOrgnr(rader);
  if (orgnr !== undefined) {
    forslag.orgnr = orgnr;
  }

  return forslag;
}

/**
 * The date the purchase was made.
 *
 * The first plausible one wins, since a receipt prints the purchase date at
 * the top and any later date is a best-before or a card expiry. A date after
 * today is dropped rather than corrected: OCR reading 2026 as 2028 is common,
 * and a verifikat dated into next year would not be bookable anyway.
 */
function hittaDatum(rader: readonly string[], idag: Datum): Datum | undefined {
  for (const rad of rader) {
    for (const tolk of [isoDatum, svensktDatum, kortDatum]) {
      const kandidat = tolk(rad);
      if (kandidat !== undefined && kandidat <= idag) {
        return kandidat;
      }
    }
  }
  return undefined;
}

/** Words an invoice puts in front of its due date, compared without diacritics. */
const FORFALLOORD = [
  'forfallodatum',
  'forfallodag',
  'forfaller',
  'betala senast',
  'betalas senast',
  'att betala senast',
  'sista betalningsdag',
  'sista betalningsdatum',
];

const ALLA_DATUM = new RegExp(`${ISO_DATUM.source}|${SVENSKT_DATUM.source}`, 'g');

/**
 * The due date an invoice states, as a suggestion for a person to confirm.
 *
 * Only a labelled date counts: an invoice also carries a fakturadatum and
 * often a period, and guessing between unlabelled dates is how a reminder
 * ends up a month late. The date is looked for after the label on the same
 * line, and otherwise on the line below, in the column nearest the label -
 * the usual layout is a row of labels over a row of values. No check against
 * today: an invoice read after it fell due still fell due on that day.
 */
export function hittaForfallodag(text: string): Datum | undefined {
  const rader = text.split(/\r?\n/);
  for (const [index, rad] of rader.entries()) {
    const normal = normalisera(rad);
    const traff = FORFALLOORD.map((ord) => ({ ord, kolumn: normal.indexOf(ord) }))
      .filter(({ kolumn }) => kolumn >= 0)
      .sort((a, b) => a.kolumn - b.kolumn)[0];
    if (traff === undefined) {
      continue;
    }

    const efter = datumMedKolumn(rad).find(
      ({ kolumn }) => kolumn >= traff.kolumn + traff.ord.length,
    );
    if (efter !== undefined) {
      return efter.datum;
    }

    const nasta = rader[index + 1];
    if (nasta === undefined) {
      continue;
    }
    const nedanfor = datumMedKolumn(nasta).sort(
      (a, b) => Math.abs(a.kolumn - traff.kolumn) - Math.abs(b.kolumn - traff.kolumn),
    )[0];
    if (nedanfor !== undefined) {
      return nedanfor.datum;
    }
  }
  return undefined;
}

function datumMedKolumn(rad: string): { datum: Datum; kolumn: number }[] {
  const funna: { datum: Datum; kolumn: number }[] = [];
  for (const match of rad.matchAll(ALLA_DATUM)) {
    const datum = isoDatum(match[0]) ?? svensktDatum(match[0]);
    if (datum !== undefined) {
      funna.push({ datum, kolumn: match.index });
    }
  }
  return funna;
}

function isoDatum(rad: string): Datum | undefined {
  const match = ISO_DATUM.exec(rad);
  return match
    ? somDatum(Number(match[1]), Number(match[2]), Number(match[3]))
    : undefined;
}

function svensktDatum(rad: string): Datum | undefined {
  const match = SVENSKT_DATUM.exec(rad);
  return match
    ? somDatum(Number(match[3]), Number(match[2]), Number(match[1]))
    : undefined;
}

function kortDatum(rad: string): Datum | undefined {
  const match = KORT_DATUM.exec(rad);
  if (!match) {
    return undefined;
  }
  // Two-digit years are this century; a receipt from 1998 is not being booked.
  return somDatum(2000 + Number(match[1]), Number(match[2]), Number(match[3]));
}

function somDatum(ar: number, manad: number, dag: number): Datum | undefined {
  try {
    return datumAv(ar, manad, dag);
  } catch {
    // Not a date the calendar has, which on a receipt means it was not a date.
    return undefined;
  }
}

/**
 * What was paid.
 *
 * A labelled amount is trusted over an unlabelled one, and a stronger label
 * over a weaker one: an invoice labels its net, its VAT and its total, and
 * only one of them is the figure to book. Within a tier the last label wins,
 * because a register prints a running "Summa" above the final one.
 *
 * The label and the figure need not be on the same line - an invoice puts
 * "Att betala" above the amount as often as beside it - so a label with no
 * amount of its own looks at the two lines below.
 *
 * With nothing labelled anywhere, the largest amount written with öre is the
 * guess. Öre are required for that case: without a label and without
 * decimals, a number is as likely to be an invoice number as an amount, and a
 * wrong figure costs far more than an empty field.
 */
function hittaTotal(rader: readonly string[]): Totalsumma | undefined {
  const normaliserade = rader.map(normalisera);
  const kandidater: Ore[][] = TOTALORD.map(() => []);
  const stod = new Map<Ore, number>();
  let storst: Ore | undefined;

  for (const [index, text] of normaliserade.entries()) {
    const rad = rader[index] ?? '';
    const pastaSidan = INTE_TOTAL.some((ord) => text.includes(ord));
    if (pastaSidan) {
      continue;
    }

    for (const kandidat of beloppPa(rad)) {
      if (kandidat.belopp === 0) {
        // A receipt for nothing is not a receipt. Zero turns up as a
        // misreading of a letter far more often than as an amount.
        continue;
      }
      stod.set(kandidat.belopp, (stod.get(kandidat.belopp) ?? 0) + 1);
      if (kandidat.harDecimaler && (storst === undefined || kandidat.belopp > storst)) {
        storst = kandidat.belopp;
      }
    }

    const markning = etikett(text);
    if (markning === undefined) {
      continue;
    }

    const belopp = beloppEfterEtikett(rader, normaliserade, index, markning.kolumn);
    if (belopp !== undefined) {
      kandidater[markning.niva]?.push(belopp);
    }
  }

  const basta = kandidater.find((lista) => lista.length > 0);
  if (basta !== undefined) {
    const belopp = medMestStod(basta, stod);
    return { belopp, markt: true, stod: stod.get(belopp) ?? 1 };
  }
  return storst === undefined
    ? undefined
    : { belopp: storst, markt: false, stod: stod.get(storst) ?? 1 };
}

/**
 * Which of several labelled totals to believe.
 *
 * A receipt states the same figure several times over - under Totalt, next to
 * the card, in the terminal's own summary - and OCR misreads one character at
 * a time. A pharmacy receipt read "Totalt 889,00" twice and "Totalt 869,00"
 * once, and 869 against 889 is not a difference anybody notices. So the
 * amount the receipt repeats most often wins, and the last one only breaks a
 * tie.
 *
 * This is the one place redundancy on a receipt is worth something: three
 * printings of a number are three chances to read it, not three chances to
 * get it wrong.
 */
function medMestStod(kandidater: readonly Ore[], stod: ReadonlyMap<Ore, number>): Ore {
  let basta = kandidater[kandidater.length - 1]!;
  let mest = stod.get(basta) ?? 0;

  for (const kandidat of kandidater) {
    const antal = stod.get(kandidat) ?? 0;
    if (antal > mest) {
      basta = kandidat;
      mest = antal;
    }
  }
  return basta;
}

/**
 * What was paid, and whether a label said so.
 *
 * The difference matters when the figure is used to judge something else: a
 * total that is only the largest number on the page is too weak to veto a VAT
 * with.
 */
interface Totalsumma {
  readonly belopp: Ore;
  readonly markt: boolean;
  /** How many times the figure appears anywhere on the receipt. */
  readonly stod: number;
}

/**
 * Which tier of total label a line carries, and where on the line it stands.
 *
 * The words are judged one at a time rather than the line as a whole, because
 * an invoice puts several of them in one row: "Totalt exkl moms   Moms
 * Avrundning   Valuta   ATT BETALA" is a column heading where one label is
 * disqualified and another is the strongest there is. Judging the line would
 * throw away both.
 */
function etikett(text: string): { niva: number; kolumn: number } | undefined {
  for (const [niva, ord] of TOTALORD.entries()) {
    for (const etikett of ord) {
      const index = text.indexOf(etikett);
      if (index === -1 || diskvalificerad(text, index + etikett.length)) {
        continue;
      }
      return { niva, kolumn: index };
    }
  }
  return undefined;
}

/**
 * Whether what follows a label turns it into something else.
 *
 * "Summa exkl. moms" is the net and "Summa moms" is the VAT, but only when the
 * word stands next to the label - further along the line it belongs to another
 * column. "Totalt inkl. moms" is the total, which is why inkl pardons moms.
 */
function diskvalificerad(text: string, efter: number): boolean {
  const svans = text.slice(efter, efter + 14);
  if (INTE_TOTALORD.some((ord) => svans.includes(ord))) {
    return true;
  }
  return svans.includes('moms') && !svans.includes('inkl');
}

/** Which tier a line carries, for callers that only need the strength. */
function etikettniva(text: string): number | undefined {
  return etikett(text)?.niva;
}

/**
 * The amount belonging to a label: on its own line, or on one of the next.
 *
 * The last figure on the label's line, because a table row reads label, net,
 * total. On a following line the first, because there the amount stands
 * alone.
 */
function beloppEfterEtikett(
  rader: readonly string[],
  normaliserade: readonly string[],
  index: number,
  kolumn: number,
): Ore | undefined {
  /*
   * On the label's own line the last figure is the one, because a table row
   * reads label, net, total - and öre are preferred over a bare number,
   * since a quantity and a line number look like numbers too.
   */
  const egna = beloppPa(rader[index] ?? '').filter((post) => post.belopp !== 0);
  const medOren = egna.filter((post) => post.harDecimaler);
  const pafol = medOren.length > 0 ? medOren : egna;
  const sista = pafol[pafol.length - 1];
  if (sista !== undefined) {
    return sista.belopp;
  }

  for (let steg = 1; steg <= RADER_UNDER_ETIKETT; steg += 1) {
    const nasta = rader[index + steg];
    const nastaText = normaliserade[index + steg];
    if (nasta === undefined || nastaText === undefined) {
      return undefined;
    }
    // A line that is a label of its own belongs to that label, not this one.
    if (etikettniva(nastaText) !== undefined) {
      return undefined;
    }
    /*
     * Below a heading, only money counts - that row is a code, a quantity and
     * a rate as well as an amount - and the money under this heading is the
     * one standing in its column. An invoice's totals row has five figures
     * and only the one under "ATT BETALA" is what to book.
     */
    const kandidater = beloppPa(nasta).filter(
      (post) => post.harDecimaler && post.belopp !== 0,
    );
    const iKolumn = kandidater.find(
      (post) => Math.abs(post.kolumn - kolumn) <= KOLUMNGLAPP,
    );
    const vald = iKolumn ?? kandidater[0];
    if (vald !== undefined) {
      return vald.belopp;
    }
  }
  return undefined;
}

/**
 * The largest share of a gross amount that can be VAT.
 *
 * The highest Swedish rate is 25 %, and 25 % of a net is 20 % of the gross.
 * Anything above that is not the VAT - most often it is the net, printed in
 * the column beside it under a heading OCR could not keep straight.
 */
const HOGSTA_MOMSANDEL = 0.2;

/**
 * Words that contain "moms" without introducing an amount.
 *
 * An invoice's footer carries "Momsreg.nr/säte" above the seller's own
 * details, and the telephone number under it reads as an amount: two real
 * invoices came back with 65,00 and 14,00 of VAT, both of them fragments of
 * "0771-21 65 00" and "0650-54 14 00".
 */
const INTE_MOMSRAD = ['momsreg', 'momsnr', 'moms.nr', 'momsregistrering'];

/**
 * The VAT, and the rate it was charged at, when the receipt says.
 *
 * Every line that mentions moms is considered, not the first: "PRODUKT MOMS
 * BELOPP" is a column heading at the head of a receipt and the summary that
 * states the VAT sits at its foot, so the last plausible one wins.
 *
 * A receipt that prints the heading on one line and the figures on the next
 * is read the same way, since that is a table rather than a sentence:
 *
 *     MOMS     NETTO      BELOPP
 *     25%      766,00     191,50
 */
function hittaMoms(
  rader: readonly string[],
  total: Totalsumma | undefined,
): { belopp?: Ore; sats?: number } | undefined {
  const normaliserade = rader.map(normalisera);
  let basta: { belopp?: Ore; sats?: number } | undefined;

  for (const [index, text] of normaliserade.entries()) {
    if (!text.includes('moms') || INTE_MOMSRAD.some((ord) => text.includes(ord))) {
      continue;
    }

    const match = MOMSRAD.exec(text);
    const egna = beloppPa(rader[index] ?? '');
    const rad = egna.length > 0 ? egna : beloppUnder(rader, index);
    const sats = match ? Number(match[1] ?? match[2]) : satsPa(rader, index, egna.length);
    const last = valjMoms(rad, total);

    if (last === undefined && sats === undefined) {
      continue;
    }

    /*
     * A zero never displaces a figure. A card terminal prints its own slip
     * under the sales part of the receipt, and "Varav moms 0,00" on it is a
     * field the terminal does not fill in rather than a statement that the
     * purchase was exempt - but it stands below the summary that does state
     * the VAT, so "the last one wins" hands over the zero. A receipt whose
     * only moms line is 0,00 still reads as zero: an exempt purchase states
     * it once and never contradicts itself.
     */
    const belopp =
      last === 0 && basta?.belopp !== undefined && basta.belopp !== 0
        ? basta.belopp
        : last;

    basta = {
      ...(belopp === undefined ? {} : { belopp }),
      ...(sats === undefined ? {} : { sats }),
    };
  }
  return basta;
}

/**
 * Which figure on a VAT line is the VAT.
 *
 * With a firm total to judge against, the largest figure that could be the
 * VAT is it - which sorts out three real receipts that disagree about column
 * order. "Underlag 740,80 Moms 185,20 Summa 926,00" puts it in the middle,
 * "MOMS NETTO BELOPP / 25% 766,00 191,50" puts it last, and a rate of 25 is a
 * figure on the line in both. Without a total there is nothing to judge with,
 * so the last one wins, which is where a summary usually ends.
 */
function valjMoms(
  rad: readonly Beloppskandidat[],
  total: Totalsumma | undefined,
): Ore | undefined {
  /*
   * Öre required. VAT is printed as money and a telephone number is not, and
   * the difference is the comma - which is the whole reason two invoices
   * offered a fragment of their own footer as the VAT.
   */
  const pengar = rad.filter((post) => post.harDecimaler);
  if (total === undefined || !total.markt) {
    return pengar[pengar.length - 1]?.belopp;
  }
  let basta: Ore | undefined;
  for (const kandidat of pengar) {
    if (
      rimligMoms(kandidat.belopp, total) &&
      (basta === undefined || kandidat.belopp > basta)
    ) {
      basta = kandidat.belopp;
    }
  }
  return basta;
}

/**
 * Whether a figure can be the VAT on what was paid.
 *
 * Only a labelled total is firm enough to judge against; a total that is
 * merely the largest number on the page proves nothing.
 */
function rimligMoms(moms: Ore, total: Totalsumma | undefined): boolean {
  if (moms < 0) {
    return false;
  }
  if (total === undefined || !total.markt) {
    return true;
  }
  return moms <= Math.round(total.belopp * HOGSTA_MOMSANDEL) + 1;
}

/** The amounts on the line under a heading that carried none itself. */
function beloppUnder(rader: readonly string[], index: number): Beloppskandidat[] {
  for (let steg = 1; steg <= RADER_UNDER_ETIKETT; steg += 1) {
    const nasta = beloppPa(rader[index + steg] ?? '');
    if (nasta.length > 0) {
      return nasta;
    }
  }
  return [];
}

/** The rate, when it stands on the figures' line rather than the heading's. */
function satsPa(
  rader: readonly string[],
  index: number,
  egnaBelopp: number,
): number | undefined {
  if (egnaBelopp > 0) {
    return undefined;
  }
  for (let steg = 1; steg <= RADER_UNDER_ETIKETT; steg += 1) {
    const match = /(?<![\d,.])(\d{1,2})(?:[.,]\d{1,2})?\s*%/.exec(
      rader[index + steg] ?? '',
    );
    if (match) {
      return Number(match[1]);
    }
  }
  return undefined;
}

/**
 * Who sold it.
 *
 * The first line near the top that reads like a name. A receipt puts the shop
 * above the address, but OCR puts its own noise above the shop - a real
 * reading began "HR Rn" before it got to "Hästsport AB" - so a line has to
 * look like words before it is believed: mostly letters, and at least one
 * word long enough to be one. Two-letter fragments are what a misread logo
 * leaves behind.
 */
function hittaLeverantor(rader: readonly string[]): string | undefined {
  for (const rad of rader.slice(0, 5)) {
    const bokstaver = rad.replace(/[^\p{L}]/gu, '').length;
    if (bokstaver < 3 || bokstaver < rad.length / 2) {
      continue;
    }
    const langstaOrd = Math.max(
      0,
      ...(rad.match(/\p{L}+/gu) ?? []).map((ord) => ord.length),
    );
    if (langstaOrd < MINSTA_NAMNORD) {
      continue;
    }
    return rad.replace(/\s+/g, ' ').trim();
  }
  return undefined;
}

function hittaOrgnr(rader: readonly string[]): string | undefined {
  for (const rad of rader) {
    if (!normalisera(rad).includes('org')) {
      continue;
    }
    const match = ORGNR.exec(rad);
    if (match) {
      return `${match[1]}-${match[2]}`;
    }
  }
  return undefined;
}

/** An amount found on a line, with what is known about how it was written. */
interface Beloppskandidat {
  readonly belopp: Ore;
  /** Written with öre, which is how money is printed and reference numbers are not. */
  readonly harDecimaler: boolean;
  /** Where on the line it starts, so a column can be matched to its heading. */
  readonly kolumn: number;
}

/**
 * Every amount on a line, in order.
 *
 * Parsed through oreFromKronor, so no amount on a receipt ever passes through
 * a float (hard rule 1). Runs of digits too long to be money are dropped
 * here rather than filtered later, because they are not amounts at all.
 */
function beloppPa(rad: string): Beloppskandidat[] {
  const funna: Beloppskandidat[] = [];
  for (const match of rad.matchAll(BELOPP)) {
    const heltal = (match[1] ?? '').replace(/[ \u00a0\u202f]/g, '');
    const decimaler = match[2];
    if (heltal.length > MAX_HELTALSSIFFROR) {
      continue;
    }
    try {
      funna.push({
        belopp: oreFromKronor(
          decimaler === undefined ? heltal : `${heltal}.${decimaler}`,
        ),
        harDecimaler: decimaler !== undefined,
        kolumn: match.index,
      });
    } catch {
      // Too large to be an amount on a receipt; it was something else.
    }
  }
  return funna;
}

function normalisera(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}
