import type { Bransch } from '../bok/bransch';
import { kontonummer } from '../konto/konto';
import type { Fraga, Lov, Nod, Svar } from './beslutstrad';

/*
 * The questions were written for a farm, and for the farm they stay exactly as
 * they were: the same answers in the same order. For any other trade the same
 * answers are put in a different order, with the ones that only a farm has at
 * the bottom, and a few of the labels say what they mean to someone who has no
 * tractor. Nothing is removed and nothing changes account or moms, so a verifikat
 * booked from one list is the same as one booked from another.
 */

const DJUR = 'Djuren';
const MASKINER = 'Maskiner, verktyg och material';
const BILEN = 'Bilen';
const FASTIGHET = 'Byggnader, el och mark';
const KONTOR = 'Telefon, internet, program och kontor';
const TJANSTER = 'Tjänster, reklam och frakt';
const AVGIFTER = 'Försäkring, bank, ränta och avgifter';
const RESOR = 'Resor';
const AMORTERING = 'Amortering på ett lån';
const VAROR = 'Varor och material som du säljer vidare eller bygger in';
const LOKAL = 'Hyra av lokal';
const REPRESENTATION = 'Representation, fika eller gåva till kund';
const ANNAT = 'Något annat';

const UT: Record<Exclude<Bransch, 'gard'>, readonly string[]> = {
  tjanster: [
    KONTOR,
    TJANSTER,
    RESOR,
    REPRESENTATION,
    LOKAL,
    BILEN,
    AVGIFTER,
    MASKINER,
    FASTIGHET,
    VAROR,
    AMORTERING,
    DJUR,
    ANNAT,
  ],
  hantverk: [
    VAROR,
    MASKINER,
    BILEN,
    KONTOR,
    TJANSTER,
    AVGIFTER,
    RESOR,
    REPRESENTATION,
    LOKAL,
    FASTIGHET,
    AMORTERING,
    DJUR,
    ANNAT,
  ],
  handel: [
    VAROR,
    LOKAL,
    TJANSTER,
    KONTOR,
    MASKINER,
    BILEN,
    AVGIFTER,
    RESOR,
    REPRESENTATION,
    FASTIGHET,
    AMORTERING,
    DJUR,
    ANNAT,
  ],
  annat: [
    KONTOR,
    TJANSTER,
    RESOR,
    REPRESENTATION,
    BILEN,
    MASKINER,
    VAROR,
    LOKAL,
    AVGIFTER,
    FASTIGHET,
    AMORTERING,
    DJUR,
    ANNAT,
  ],
};

const DJUR_IN = 'Sålt levande djur';
const LIVSMEDEL_IN = 'Sålt kött eller andra livsmedel';
const VAROR_IN = 'Sålt ull, skinn eller andra varor';
const TJANST_IN = 'Utfört arbete eller en tjänst';
const MASKIN_IN = 'Sålt en maskin eller inventarie';
const STOD_IN = 'Stöd eller bidrag';
const FORSAKRING_IN = 'Ersättning från försäkringen';
const RANTA_IN = 'Ränta på kontot';
const MOMS_IN = 'Moms tillbaka från Skatteverket';
const EGNA_IN = 'Egna pengar in i firman';
const LAN_IN = 'Ett lån';

const IN: Record<Exclude<Bransch, 'gard'>, readonly string[]> = {
  tjanster: [
    TJANST_IN,
    VAROR_IN,
    MASKIN_IN,
    STOD_IN,
    FORSAKRING_IN,
    RANTA_IN,
    MOMS_IN,
    EGNA_IN,
    LAN_IN,
    LIVSMEDEL_IN,
    DJUR_IN,
  ],
  hantverk: [
    TJANST_IN,
    VAROR_IN,
    MASKIN_IN,
    STOD_IN,
    FORSAKRING_IN,
    RANTA_IN,
    MOMS_IN,
    EGNA_IN,
    LAN_IN,
    LIVSMEDEL_IN,
    DJUR_IN,
  ],
  handel: [
    VAROR_IN,
    TJANST_IN,
    LIVSMEDEL_IN,
    MASKIN_IN,
    STOD_IN,
    FORSAKRING_IN,
    RANTA_IN,
    MOMS_IN,
    EGNA_IN,
    LAN_IN,
    DJUR_IN,
  ],
  annat: [
    TJANST_IN,
    VAROR_IN,
    LIVSMEDEL_IN,
    MASKIN_IN,
    STOD_IN,
    FORSAKRING_IN,
    RANTA_IN,
    MOMS_IN,
    EGNA_IN,
    LAN_IN,
    DJUR_IN,
  ],
};

/** Labels that name something only a farm has, said for everyone else. */
const TEXTER: ReadonlyMap<string, string> = new Map([
  [FASTIGHET, 'El, vatten och fastighet'],
  [VAROR_IN, 'Sålt varor'],
  ['Material, reservdelar eller stängsel', 'Material eller reservdelar'],
  ['Drivmedel till traktor eller maskin', 'Drivmedel till maskin'],
]);

/** The same, for a leaf's own name, which is what a search result shows. */
const LOVNAMN: ReadonlyMap<string, string> = new Map([
  ['fastighet', 'El, vatten och fastighet'],
  ['drivmedel', 'Drivmedel till maskin'],
]);

const BANKEN = kontonummer('1930');
const EGNA_PENGAR = kontonummer('2017');

/**
 * Orders answers by a list of their texts; any the list does not name keep
 * their own order, after the ones it does.
 */
function ordna(svar: readonly Svar[], ordning: readonly string[]): Svar[] {
  const rang = (post: Svar, index: number) => {
    const plats = ordning.indexOf(post.text);
    return plats === -1 ? ordning.length + index : plats;
  };
  return svar
    .map((post, index) => ({ post, rang: rang(post, index) }))
    .sort((a, b) => a.rang - b.rang)
    .map((post) => post.post);
}

/**
 * Pays from the firm's account first. The farm's list offers one's own money
 * first because that is how most of its purchases were paid; for a firm that
 * has a business account, that is the odd one out.
 */
function betalsattFor(lov: Lov): Lov['betalsatt'] {
  if (lov.betalsatt[0] === EGNA_PENGAR && lov.betalsatt.includes(BANKEN)) {
    return [BANKEN, ...lov.betalsatt.filter((konto) => konto !== BANKEN)];
  }
  return lov.betalsatt;
}

function anpassaNod(nod: Nod, bransch: Exclude<Bransch, 'gard'>): Nod {
  if (nod.typ === 'lov') {
    const namn = LOVNAMN.get(nod.id);
    return {
      ...nod,
      ...(namn === undefined ? {} : { namn }),
      betalsatt: betalsattFor(nod),
    };
  }
  if (nod.typ === 'hanvisning') {
    return nod;
  }
  const svar =
    nod.id === 'pengar-ut'
      ? ordna(nod.svar, UT[bransch])
      : nod.id === 'pengar-in'
        ? ordna(nod.svar, IN[bransch])
        : nod.svar;
  return {
    ...nod,
    svar: svar.map((post) => ({
      text: TEXTER.get(post.text) ?? post.text,
      till: anpassaNod(post.till, bransch),
    })),
  };
}

const cachade = new WeakMap<Fraga, Map<Bransch, Fraga>>();

/**
 * The booking questions for a firm of this trade.
 *
 * For a farm, the questions as written. For any other trade, the same answers
 * in an order that fits it. Cached, because the screens ask on every render
 * and the same tree has to come back as the same object.
 */
export function anpassaTrad(rot: Fraga, bransch: Bransch): Fraga {
  if (bransch === 'gard') {
    return rot;
  }
  const perBransch = cachade.get(rot) ?? new Map<Bransch, Fraga>();
  cachade.set(rot, perBransch);
  const funnen = perBransch.get(bransch);
  if (funnen !== undefined) {
    return funnen;
  }
  const ny = anpassaNod(rot, bransch) as Fraga;
  perBransch.set(bransch, ny);
  return ny;
}
