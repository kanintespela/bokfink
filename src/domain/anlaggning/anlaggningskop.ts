import { add, ZERO, type Ore } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import type { BokfortVerifikat } from '../verifikat/verifikat';

/**
 * Which part of the register a booked purchase belongs in.
 *
 * The first three are written off, each by its own rules (see avskrivning.ts
 * and fastighetstillgang.ts); mark never is.
 */
export type Anlaggningsslag = 'inventarie' | 'byggnad' | 'markanlaggning' | 'mark';

/** A booked verifikat that looks like the purchase of an anläggningstillgång. */
export interface Anlaggningskop {
  readonly verifikat: BokfortVerifikat;
  readonly slag: Anlaggningsslag;
  /** What the verifikat added to the asset accounts: the cost, without moms. */
  readonly belopp: Ore;
}

/*
 * The account groups a purchase of each kind is booked in. These are the
 * BAS chart's own groups, the same in the K1 chart a firm starts with and in
 * the full one an imported set of books brings: 111x Byggnader, 113x Mark,
 * 115x Markanläggningar and 12xx Maskiner och inventarier.
 *
 * Whole groups rather than single accounts, so that what is counted is what
 * the verifikat added to the group. A depreciation credits the group's own
 * "ackumulerade avskrivningar" account, and the year-end transfer of this
 * year's purchases moves an amount between two accounts in it: neither adds
 * anything, and neither is a purchase.
 */
const KONTOGRUPPER: readonly (readonly [string, Anlaggningsslag])[] = [
  ['111', 'byggnad'],
  ['113', 'mark'],
  ['115', 'markanlaggning'],
  ['12', 'inventarie'],
];

function slagForKonto(konto: string): Anlaggningsslag | undefined {
  return KONTOGRUPPER.find(([prefix]) => konto.startsWith(prefix))?.[1];
}

/**
 * The booked purchases that no register entry points at.
 *
 * This is a suggestion and nothing more (hard rule 10): the list is what the
 * app offers to take up in the register, and the user decides for each one
 * whether it is an asset at all. It is found from the accounts, not from how
 * the verifikat came to be booked, so that a purchase booked from the
 * receipt assistant's draft or by hand is found like one booked through the
 * questions.
 *
 * Left out: a verifikat that has been annulled, one a register entry already
 * points at, and one the user has said is not an asset.
 */
export function oregistreradeAnlaggningskop(
  verifikat: readonly BokfortVerifikat[],
  registrerade: ReadonlySet<Uuid>,
  avfardade: ReadonlySet<Uuid> = new Set(),
): Anlaggningskop[] {
  const annullerade = new Set(
    verifikat.flatMap((post) => (post.annullerar === undefined ? [] : [post.annullerar])),
  );

  const kop: Anlaggningskop[] = [];
  for (const post of verifikat) {
    if (
      post.annullerar !== undefined ||
      annullerade.has(post.id) ||
      registrerade.has(post.id) ||
      avfardade.has(post.id)
    ) {
      continue;
    }

    const perSlag = new Map<Anlaggningsslag, Ore>();
    for (const rad of post.konteringar) {
      const slag = slagForKonto(rad.konto);
      if (slag !== undefined) {
        perSlag.set(slag, add(perSlag.get(slag) ?? ZERO, rad.belopp));
      }
    }

    // One suggestion per verifikat: the kind it added the most to.
    let storst: { slag: Anlaggningsslag; belopp: Ore } | undefined;
    for (const [slag, belopp] of perSlag) {
      if (belopp > ZERO && (storst === undefined || belopp > storst.belopp)) {
        storst = { slag, belopp };
      }
    }
    if (storst !== undefined) {
      kop.push({ verifikat: post, ...storst });
    }
  }
  return kop;
}
