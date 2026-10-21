/**
 * A verifikatserie: the label a run of verification numbers belongs to.
 *
 * SIE writes it as the first field of #VER, and real books use short labels
 * like "A" and "V". Kontera gives every device its own series, so two devices
 * can hand out numbers offline without agreeing on anything
 * (docs/UTVECKLINGSPLAN.md, 3.1).
 */
export type Verifikatserie = string & { readonly __brand: 'Verifikatserie' };

const SERIE = /^[A-ZÅÄÖ0-9]{1,4}$/;

export function verifikatserie(text: string): Verifikatserie {
  const trimmed = text.trim().toUpperCase();
  if (!SERIE.test(trimmed)) {
    throw new TypeError(
      `"${text}" är inte en verifikatserie. En serie är en till fyra bokstäver ` +
        'eller siffror, till exempel A.',
    );
  }
  return trimmed as Verifikatserie;
}

/**
 * The next number in a series, given the highest one already handed out.
 *
 * Hard rule 6: an unbroken run per series and fiscal year, never reused and
 * never renumbered. Numbers follow the order things were booked, not the
 * dates they happened on - a verifikat entered today for last month's receipt
 * still takes the next number. The existing books do this thirty times over
 * four years, so it is the normal case rather than an edge one.
 *
 * Deliberately takes the highest used number rather than a count. A count
 * would quietly restart the series if a row went missing, which is exactly
 * the failure hard rule 6 exists to prevent.
 */
export function nastaVerifikationsnummer(hogstaAnvanda?: number): number {
  if (hogstaAnvanda === undefined) {
    return 1;
  }
  if (!Number.isInteger(hogstaAnvanda) || hogstaAnvanda < 1) {
    throw new TypeError(
      `Högsta använda verifikationsnummer måste vara ett positivt heltal, ` +
        `fick ${hogstaAnvanda}.`,
    );
  }
  return hogstaAnvanda + 1;
}

export interface Seriegranskning {
  readonly luckor: readonly number[];
  readonly dubbletter: readonly number[];
  readonly obruten: boolean;
}

/**
 * Checks that a series really is unbroken.
 *
 * Run over an imported series before it is trusted, and over the ledger's own
 * as a standing check: hard rule 6 is not something to assume held, since a
 * gap means either a lost verifikat or a number that was never issued, and
 * both have to be visible rather than inferred later at an audit.
 */
export function granskaSerie(nummer: readonly number[]): Seriegranskning {
  if (nummer.length === 0) {
    return { luckor: [], dubbletter: [], obruten: true };
  }

  const sedda = new Set<number>();
  const dubbletter = new Set<number>();
  for (const n of nummer) {
    if (sedda.has(n)) {
      dubbletter.add(n);
    }
    sedda.add(n);
  }

  const luckor: number[] = [];
  const hogsta = Math.max(...sedda);
  // A series always starts at 1, so a missing 1 is a gap like any other.
  for (let n = 1; n <= hogsta; n += 1) {
    if (!sedda.has(n)) {
      luckor.push(n);
    }
  }

  return {
    luckor,
    dubbletter: [...dubbletter].sort((a, b) => a - b),
    obruten: luckor.length === 0 && dubbletter.size === 0,
  };
}
