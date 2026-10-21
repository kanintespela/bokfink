import { add, isZero, negate, ore, sum, ZERO, type Ore } from '../belopp/ore';
import { kontonummer, type Kontonummer } from '../konto/konto';
import { inomIntervall, type Datum } from '../tid/datum';
import type { BokfortVerifikat, Kontering } from '../verifikat/verifikat';
import { RUTA, standardredovisning, type Momsredovisning, type Ruta } from './rutor';

export interface Rutabelopp {
  readonly ruta: Ruta;
  /** What the box says, in whole kronor stored as öre. */
  readonly belopp: Ore;
  /** What the books hold, to the öre, before the box dropped them. */
  readonly exakt: Ore;
}

/**
 * Drops the öre, as a tax return does.
 *
 * Hard rule 2: the rounding is explicit, named, and has its source.
 * Skatteförfarandeförordning (2011:1261) 22 kap. 1 §: amounts are stated in whole
 * kronor "så att öretal faller bort". That is truncation towards zero, not
 * rounding to the nearest krona - 2 087,57 kr becomes 2 087, not 2 088.
 *
 * Applied per box rather than only to the total, because each box is itself
 * an amount the return states. Checked against four quarters of real
 * declarations, where it reproduces every one.
 */
export function krontal(belopp: Ore): Ore {
  const kronor = Math.floor(Math.abs(belopp) / 100) * 100;
  // Guard against -0, which compares equal to 0 but prints with a sign.
  if (kronor === 0) {
    return ZERO;
  }
  return ore(belopp < 0 ? -kronor : kronor);
}

export interface Momsrapport {
  readonly fran: Datum;
  readonly till: Datum;
  readonly rader: readonly Rutabelopp[];
  /** Box 49: positive is VAT to pay, negative is VAT to get back. */
  readonly attBetala: Ore;
}

export interface Momsrapportunderlag {
  readonly fran: Datum;
  readonly till: Datum;
  readonly verifikat: Iterable<BokfortVerifikat>;
  /** Per-account override of what the account reports. */
  readonly redovisning?: (konto: Kontonummer) => Momsredovisning | undefined;
}

/*
 * Boxes whose VAT is owed rather than deducted.
 *
 * 10-12 is output VAT on your own sales, 30-32 on purchases where you are the
 * one liable, 60-62 on import. All of them are money to Skatteverket; box 48
 * is the only one that goes the other way.
 */
const UTGAENDE = [10, 11, 12, 30, 31, 32, 60, 61, 62];
const INGAENDE = 48;

/**
 * The VAT return for a period.
 *
 * Built from what the accounts moved rather than from a VAT code on each
 * line, which is the only way it can work at all on a ledger read in from a
 * SIE file - such a file carries no codes. An account may still override what
 * it reports; the defaults only decide what nobody has said otherwise about.
 *
 * Signs are flipped on the way out. Bookkeeping credits income and output VAT,
 * so both sit negative in the ledger, while the declaration asks for what was
 * sold and what is owed as positive figures.
 */
export function beraknaMomsrapport(underlag: Momsrapportunderlag): Momsrapport {
  const { fran, till } = underlag;
  const redovisning = underlag.redovisning ?? standardredovisning;

  const perRuta = new Map<number, Ore>();

  for (const verifikat of underlag.verifikat) {
    if (!inomIntervall(verifikat.datum, fran, till)) {
      continue;
    }
    // The period's own settlement moves its moms to 2650; counted, it would
    // cancel the period it settles. See arMomsavrakning.
    if (arMomsavrakning(verifikat.konteringar, redovisning)) {
      continue;
    }
    const radensRedovisning = medInventarieforsaljning(
      verifikat.konteringar,
      redovisning,
    );
    for (const rad of verifikat.konteringar) {
      const vart = radensRedovisning(rad.konto);
      if (vart === undefined) {
        continue;
      }
      perRuta.set(vart.ruta, add(perRuta.get(vart.ruta) ?? ZERO, rad.belopp));
    }
  }

  const rader: Rutabelopp[] = [];
  for (const [nummer, saldo] of perRuta) {
    const ruta = RUTA.get(nummer);
    if (ruta === undefined) {
      continue;
    }
    // Income and output VAT are credits, so they arrive negative; the
    // declaration wants them the way a person would say them out loud.
    const exakt = nummer === INGAENDE ? saldo : negate(saldo);
    rader.push({ ruta, belopp: krontal(exakt), exakt });
  }

  rader.sort((a, b) => a.ruta.nummer - b.ruta.nummer);

  const utgaende = sum(
    rader.filter((rad) => UTGAENDE.includes(rad.ruta.nummer)).map((rad) => rad.belopp),
  );
  const ingaende = sum(
    rader.filter((rad) => rad.ruta.nummer === INGAENDE).map((rad) => rad.belopp),
  );

  /*
   * Box 49 adds up the boxes as they are stated, not as the books hold them.
   * That is what makes the return agree with itself: a reader adding the
   * printed figures has to arrive at the printed total.
   */
  const attBetala = add(utgaende, negate(ingaende));
  const ruta49 = RUTA.get(49);

  return {
    fran,
    till,
    rader:
      ruta49 === undefined
        ? rader
        : [...rader, { ruta: ruta49, belopp: attBetala, exakt: attBetala }],
    attBetala,
  };
}

/**
 * Whether booking these rows could change a momsdeklaration.
 *
 * True when any row lands on an account the declaration reads - a moms
 * account or a sales account - by the same mapping the report itself uses,
 * so the two can never disagree about what a declaration is made of. A
 * periodisering, an avskrivning or a move between 2650 and 1650 reads as
 * false: none of them reaches a box.
 */
export function paverkarMomsdeklarationen(
  konteringar: readonly Kontering[],
  redovisning: (konto: Kontonummer) => Momsredovisning | undefined = standardredovisning,
): boolean {
  return (
    !arMomsavrakning(konteringar, redovisning) &&
    konteringar.some((rad) => redovisning(rad.konto) !== undefined)
  );
}

/** BAS K1 1222 Årets ersättning för maskiner och inventarier. */
export const INVENTARIEERSATTNING = kontonummer('1222');

/**
 * The mapping for one verifikat, with a sold inventarie counted as a sale.
 *
 * K1 books what a machine or an inventarie was sold for on 1222 rather than
 * on a sales account, but the sale is omsättning all the same: its moms goes
 * to box 10-12 and the price without moms to box 05 (mervärdesskattelagen
 * (2023:200) 3 kap. 1 §; Skatteverket, Fylla i momsdeklarationen, ruta 05).
 * Only a verifikat that charges utgående moms on the sale counts it - the
 * year-end move of 1222 onto 1220 carries none, and is no sale.
 */
function medInventarieforsaljning(
  konteringar: readonly Kontering[],
  redovisning: (konto: Kontonummer) => Momsredovisning | undefined,
): (konto: Kontonummer) => Momsredovisning | undefined {
  const tarUtUtgaendeMoms = konteringar.some((rad) => {
    const vart = redovisning(rad.konto);
    return vart?.slag === 'moms' && [10, 11, 12].includes(vart.ruta);
  });
  if (!tarUtUtgaendeMoms) {
    return redovisning;
  }
  return (konto) =>
    konto === INVENTARIEERSATTNING && redovisning(konto) === undefined
      ? { slag: 'underlag', ruta: 5 }
      : redovisning(konto);
}

/** BAS 2650 Redovisningskonto för moms, where a period's moms is settled. */
export const MOMSREDOVISNINGSKONTO = kontonummer('2650');

/** BAS 3740 Öresutjämning, where a settlement puts the öre the boxes drop. */
const ORESUTJAMNING = kontonummer('3740');

/**
 * Whether a verifikat is a momsredovisning: the moms accounts emptied into
 * 2650 at the end of a period.
 *
 * Recognised by what it moves, since imported books name it anything
 * ("Automatisk momsöverföring" in one program): at least one moms account, the
 * redovisningskonto 2650, and nothing else but 3740 for the öre the
 * declaration drops. Öre cleared off a moms account against 3740 alone -
 * "nollning av konto 2641" - counts the same way. It records no affärshändelse - it moves balances that
 * the period's purchases and sales already put there - so the report leaves
 * it out. Dated the period's last day, as it always is, it would otherwise
 * cancel the very period it settles.
 *
 * A payment from 2650 to the skattekonto or the bank has no moms account in
 * it and is not a settlement; it reaches no box in any case.
 */
export function arMomsavrakning(
  konteringar: readonly Kontering[],
  redovisning: (konto: Kontonummer) => Momsredovisning | undefined = standardredovisning,
): boolean {
  let harMomskonto = false;
  let harRedovisningskonto = false;
  for (const rad of konteringar) {
    if (rad.konto === MOMSREDOVISNINGSKONTO) {
      harRedovisningskonto = true;
    } else if (redovisning(rad.konto)?.slag === 'moms') {
      harMomskonto = true;
    } else if (rad.konto !== ORESUTJAMNING) {
      return false;
    }
  }
  return harMomskonto && (harRedovisningskonto || endastOresutjamning(konteringar));
}

/**
 * Öre cleared off a moms account: by the time this is asked, every row is a
 * moms account or 3740, so what remains to check is that none is a krona or
 * more. Rounding left behind, not tax on anything - the same kind of entry as
 * the öre line of a settlement, booked on its own.
 */
function endastOresutjamning(konteringar: readonly Kontering[]): boolean {
  return konteringar.every((rad) => Math.abs(rad.belopp) < 100);
}

/** The amount in one box, or zero when nothing reached it. */
export function ruta(rapport: Momsrapport, nummer: number): Ore {
  return rapport.rader.find((rad) => rad.ruta.nummer === nummer)?.belopp ?? ZERO;
}

/**
 * The boxes a periodisk sammanställning is built from.
 *
 * Goods and services sold into the EU, which have to be listed per buyer's
 * VAT number in a separate return alongside the momsdeklaration.
 */
export const EU_FORSALJNING = [35, 37, 38, 39];

/** Whether anything was sold into the EU in the period. */
export function harEuForsaljning(rapport: Momsrapport): boolean {
  return rapport.rader.some(
    (rad) => EU_FORSALJNING.includes(rad.ruta.nummer) && !isZero(rad.belopp),
  );
}
