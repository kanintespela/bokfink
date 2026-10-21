import {
  add,
  delaOchAvrunda,
  isZero,
  negate,
  ore,
  sum,
  ZERO,
  type Ore,
} from '../belopp/ore';
import {
  INTAKTSRADER,
  KOSTNADSRADER,
  TILLGANGSRADER,
  type Balansrad,
  type ForenkladArsbokslut,
  type Resultatrad,
} from '../bokslut/forenkladArsbokslut';

/**
 * The NE-bilaga (SKV 2161), "Inkomst av näringsverksamhet, enskilda
 * näringsidkare", worked out from the förenklade årsbokslutet.
 *
 * Field codes and signs are Skatteverket's own, from the fältnamnstabell
 * NE_SKV2161-13-02-25-02 in the SRU package for beskattningsperiod 2025P4.
 * The link between the boxes and the BAS accounts is BAS's NE K1
 * kopplingstabell, which uses the same boxes as the förenklade årsbokslutet,
 * so page 1 is that form rounded to whole kronor.
 *
 * Page 2 adjusts the booked result to the taxable one. The adjustments that
 * are not in the books - last year's underskott, egenavgifter from the
 * slutskattebesked, a periodiseringsfond - are entered, not computed here.
 */

/** Page 1 box → SRU field code. B11 and B12 are never filled in under K1. */
export const FALTKOD_SIDA1: Readonly<Record<Balansrad | Resultatrad | 'R11', string>> = {
  B1: '7200',
  B2: '7210',
  B3: '7211',
  B4: '7212',
  B5: '7213',
  B6: '7240',
  B7: '7250',
  B8: '7260',
  B9: '7280',
  B10: '7300',
  B13: '7380',
  B14: '7381',
  B15: '7382',
  B16: '7383',
  R1: '7400',
  R2: '7401',
  R3: '7402',
  R4: '7403',
  R5: '7500',
  R6: '7501',
  R7: '7502',
  R8: '7503',
  R9: '7504',
  R10: '7505',
  R11: '7440',
};

/**
 * The adjustments on page 2 that are entered, with the field code and whether
 * the form adds or subtracts them. R17, R21, R29, R33, R35 and R42 are
 * subtotals the form works out and the file does not carry; R12 is R11
 * carried over; R47 and R48 are the result.
 *
 * R20 has two fields, one for each direction, so it appears twice.
 */
export const JUSTERINGAR = [
  {
    rad: 'R13',
    faltkod: '7601',
    tecken: 1,
    text: 'Bokförda kostnader som inte ska dras av',
  },
  {
    rad: 'R14',
    faltkod: '7700',
    tecken: -1,
    text: 'Bokförda intäkter som inte ska tas upp',
  },
  {
    rad: 'R15',
    faltkod: '7602',
    tecken: 1,
    text: 'Intäkter som inte bokförts men som ska tas upp',
  },
  {
    rad: 'R16',
    faltkod: '7701',
    tecken: -1,
    text: 'Kostnader som inte bokförts men som ska dras av',
  },
  {
    rad: 'R18',
    faltkod: '7702',
    tecken: -1,
    text: 'Gemensam verksamhet: överskott redovisat av annan eller min andel av underskott',
  },
  {
    rad: 'R19',
    faltkod: '7603',
    tecken: 1,
    text: 'Gemensam verksamhet: underskott redovisat av annan eller min andel av överskott',
  },
  { rad: 'R20+', faltkod: '7614', tecken: 1, text: 'Min andel som medhjälpande make' },
  { rad: 'R20-', faltkod: '7703', tecken: -1, text: 'Andel till medhjälpande make' },
  {
    rad: 'R22',
    faltkod: '7704',
    tecken: -1,
    text: 'Övriga skattemässiga justeringar, kostnader',
  },
  {
    rad: 'R23',
    faltkod: '7604',
    tecken: 1,
    text: 'Övriga skattemässiga justeringar, intäkter',
  },
  {
    rad: 'R24',
    faltkod: '7705',
    tecken: -1,
    text: 'Outnyttjat underskott från föregående år (R48 i förra årets NE)',
  },
  {
    rad: 'R25',
    faltkod: '7706',
    tecken: -1,
    text: 'Skogsavdrag/substansminskningsavdrag enligt N8',
  },
  {
    rad: 'R26',
    faltkod: '7605',
    tecken: 1,
    text: 'Återföring av värdeminskningsavdrag m.m. vid avyttring av näringsfastighet',
  },
  {
    rad: 'R27',
    faltkod: '7606',
    tecken: 1,
    text: 'Uttag från skogs-, skogsskade- eller upphovsmannakonto',
  },
  {
    rad: 'R28',
    faltkod: '7707',
    tecken: -1,
    text: 'Inbetalning till skogs-, skogsskade- eller upphovsmannakonto',
  },
  { rad: 'R30', faltkod: '7708', tecken: -1, text: 'Positiv räntefördelning' },
  { rad: 'R31', faltkod: '7607', tecken: 1, text: 'Negativ räntefördelning' },
  { rad: 'R32', faltkod: '7608', tecken: 1, text: 'Återföring av periodiseringsfond' },
  { rad: 'R34', faltkod: '7709', tecken: -1, text: 'Avsättning till periodiseringsfond' },
  { rad: 'R36', faltkod: '7710', tecken: -1, text: 'Ökning av expansionsfond' },
  { rad: 'R37', faltkod: '7609', tecken: 1, text: 'Minskning av expansionsfond' },
  {
    rad: 'R38',
    faltkod: '7711',
    tecken: -1,
    text: 'Egna pensionspremier eller inbetalning på pensionssparkonto',
  },
  {
    rad: 'R39',
    faltkod: '7712',
    tecken: -1,
    text: 'Särskild löneskatt på pensionssparavdrag i R38',
  },
  {
    rad: 'R40',
    faltkod: '7610',
    tecken: 1,
    text: 'Medgivna avdrag för egenavgifter föregående år (R43 i förra årets NE)',
  },
  {
    rad: 'R41',
    faltkod: '7713',
    tecken: -1,
    text: 'Påförda egenavgifter enligt slutskattebesked',
  },
  {
    rad: 'R43',
    faltkod: '7714',
    tecken: -1,
    text: 'Årets beräknade avdrag för egenavgifter',
  },
  {
    rad: 'R44',
    faltkod: '7611',
    tecken: 1,
    text: 'Sjukpenning som hör till näringsverksamheten',
  },
  {
    rad: 'R45',
    faltkod: '7612',
    tecken: 1,
    text: 'Allmänt avdrag, utnyttjat underskott vid konstnärlig eller nystartad verksamhet',
  },
  {
    rad: 'R46',
    faltkod: '7613',
    tecken: 1,
    text: 'Underskott som utnyttjas i kapital, m.m.',
  },
] as const;

export type Justeringsrad = (typeof JUSTERINGAR)[number]['rad'];

/**
 * R39 and R41 are Numeriskt_A in the fältnamnstabell and may be negative -
 * a slutskattebesked can reverse egenavgifter. Every other adjustment is
 * Numeriskt_B, zero or more.
 */
const FAR_VARA_NEGATIV = new Set<Justeringsrad>(['R39', 'R41']);

export const FALTKOD_R12 = '7600';
export const FALTKOD_R47 = '7630';
export const FALTKOD_R48 = '7730';

/**
 * Rounds an amount to the nearest whole krona, halves away from zero.
 *
 * Hard rule 2. Skatteverket's instructions for the NE-bilaga say amounts are
 * given "avrundat till hela kronor" (skatteverket.se, Fylla i NE-bilagan,
 * Balans- och resultaträkning), and the form says "Ange belopp i hela
 * kronor". The truncation in skatteförfarandeförordningen 22 kap. 1 §, which
 * the momsdeklaration follows, covers amounts that concern a skatt or avgift;
 * the NE boxes are income and balance figures, so the ordinary meaning of
 * avrunda applies. The difference is at most 50 öre per box.
 */
export function avrundaTillHelKrona(belopp: Ore): Ore {
  const kronor = delaOchAvrunda(belopp, 100);
  // -0,40 kr rounds to a krona of -0, which prints with a sign in a file.
  return kronor === 0 ? ZERO : ore(kronor * 100);
}

export interface Nerad {
  /** The row as the form prints it: 'B1', 'R11', 'R20+' and so on. */
  readonly rad: string;
  readonly faltkod: string;
  /** Whole kronor, as öre. Positive unless the field allows a sign. */
  readonly belopp: Ore;
}

export interface Nebilaga {
  /** Page 1, every box with something in it, in form order. */
  readonly sida1: readonly Nerad[];
  /** Page 2: R12, the entered adjustments that are not zero, and R47 or R48. */
  readonly sida2: readonly Nerad[];
  /** Positive is an överskott (R47), negative an underskott (R48). */
  readonly resultat: Ore;
  /**
   * What rounding each box moved B10 and R11 by, compared with the unrounded
   * form. B10 and R11 are worked out from the rounded boxes, as the form
   * defines them, so page 1 always adds up.
   */
  readonly avrundningB10: Ore;
  readonly avrundningR11: Ore;
  /** Reasons the bilaga cannot be filed as it stands. Empty when it can. */
  readonly hinder: readonly string[];
}

/**
 * Works out the NE-bilaga from the year's förenklade årsbokslut and the
 * adjustments the user entered, in whole kronor (as öre).
 *
 * The bokslut must be complete - every account placed, both sides equal -
 * and the adjustments within what the form allows. Anything that is not
 * comes back in `hinder` rather than as a figure (hard rule 11).
 */
export function beraknaNebilaga(
  bokslut: ForenkladArsbokslut,
  justeringar: Readonly<Partial<Record<Justeringsrad, Ore>>>,
): Nebilaga {
  const hinder: string[] = [];

  for (const post of bokslut.kraverVal) {
    hinder.push(`Välj ruta för konto ${post.konto} i årsbokslutet.`);
  }
  for (const saldo of bokslut.kontonUtanRuta) {
    hinder.push(`Konto ${saldo.konto} har saldo men ingen ruta i årsbokslutet.`);
  }
  if (!isZero(bokslut.differens)) {
    hinder.push('Årsbokslutets balansräkning går inte ihop.');
  }
  if (!isZero(bokslut.resultatdifferens)) {
    hinder.push('Årsbokslutets resultat skiljer sig från bokföringens.');
  }

  const avrundad = (rad: Balansrad | Resultatrad): Ore =>
    avrundaTillHelKrona(bokslut.rutor.get(rad)?.belopp ?? ZERO);

  const SKULDER: readonly Balansrad[] = ['B13', 'B14', 'B15', 'B16'];
  const tillgangar = sum(TILLGANGSRADER.map(avrundad));
  const skulder = sum(SKULDER.map(avrundad));
  // "B10. Eget kapital (tillgångar - skulder)", as the form itself defines it.
  const b10 = add(tillgangar, negate(skulder));
  // "R11. Bokfört resultat (+/-) =", the sum of the rows above it.
  const r11 = add(
    sum(INTAKTSRADER.map(avrundad)),
    negate(sum(KOSTNADSRADER.map(avrundad))),
  );

  const sida1: Nerad[] = [];
  const lagg = (rad: keyof typeof FALTKOD_SIDA1, belopp: Ore) => {
    if (!isZero(belopp)) {
      sida1.push({ rad, faltkod: FALTKOD_SIDA1[rad], belopp });
    }
  };
  for (const rad of TILLGANGSRADER) {
    lagg(rad, avrundad(rad));
  }
  lagg('B10', b10);
  for (const rad of SKULDER) {
    lagg(rad, avrundad(rad));
  }
  for (const rad of [...INTAKTSRADER, ...KOSTNADSRADER]) {
    lagg(rad, avrundad(rad));
  }
  lagg('R11', r11);

  const varde = (rad: Justeringsrad): Ore => justeringar[rad] ?? ZERO;
  for (const { rad } of JUSTERINGAR) {
    const belopp = varde(rad);
    if (belopp % 100 !== 0) {
      hinder.push(`${rad} ska anges i hela kronor.`);
    }
    if (belopp < 0 && !FAR_VARA_NEGATIV.has(rad)) {
      hinder.push(`${rad} kan inte vara negativt.`);
    }
  }

  // The form's own subtotals, in order. Each is the one above it with the
  // rows in between added or subtracted as their sign column says.
  const efter = (fran: Ore, rader: readonly Justeringsrad[]): Ore =>
    rader.reduce((summa, rad) => {
      const { tecken } = JUSTERINGAR.find((post) => post.rad === rad)!;
      return add(summa, tecken > 0 ? varde(rad) : negate(varde(rad)));
    }, fran);

  const r17 = efter(r11, ['R13', 'R14', 'R15', 'R16']);
  const r21 = efter(r17, ['R18', 'R19', 'R20+', 'R20-']);
  const r29 = efter(r21, ['R22', 'R23', 'R24', 'R25', 'R26', 'R27', 'R28']);
  // R30: "Positiv räntefördelning, dock högst överskott vid R29".
  if (varde('R30') > Math.max(r29, 0)) {
    hinder.push('R30 får vara högst överskottet i R29.');
  }
  const r33 = efter(r29, ['R30', 'R31', 'R32']);
  // R34: "Avsättning till periodiseringsfond, dock högst 30 % av överskott
  // vid R33". Compared as 10 × R34 ≤ 3 × R33 so no fraction is ever formed.
  if (10 * varde('R34') > 3 * Math.max(r33, 0)) {
    hinder.push('R34 får vara högst 30 % av överskottet i R33.');
  }
  const r35 = efter(r33, ['R34']);
  // R36: "Ökning av expansionsfond dock högst överskott vid R35".
  if (varde('R36') > Math.max(r35, 0)) {
    hinder.push('R36 får vara högst överskottet i R35.');
  }
  const r42 = efter(r35, ['R36', 'R37', 'R38', 'R39', 'R40', 'R41']);
  const resultat = efter(r42, ['R43', 'R44', 'R45', 'R46']);

  const sida2: Nerad[] = [];
  if (!isZero(r11)) {
    sida2.push({ rad: 'R12', faltkod: FALTKOD_R12, belopp: r11 });
  }
  for (const { rad, faltkod } of JUSTERINGAR) {
    if (!isZero(varde(rad))) {
      sida2.push({ rad, faltkod, belopp: varde(rad) });
    }
  }
  // R47 and R48 exclude each other; the file carries the underskott as a
  // positive amount in 7730, since the field is Numeriskt_B.
  if (resultat > 0) {
    sida2.push({ rad: 'R47', faltkod: FALTKOD_R47, belopp: resultat });
  } else if (resultat < 0) {
    sida2.push({ rad: 'R48', faltkod: FALTKOD_R48, belopp: negate(resultat) });
  }

  return {
    sida1,
    sida2,
    resultat,
    avrundningB10: add(b10, negate(bokslut.rutor.get('B10')?.belopp ?? ZERO)),
    avrundningR11: add(r11, negate(bokslut.bokfortResultat)),
    hinder,
  };
}
