import { isZero, negate, type Ore } from '../belopp/ore';
import { kontonummer, type Kontonummer } from '../konto/konto';
import type { Kontosaldo } from '../rapport/saldon';
import type { Kontering } from '../verifikat/verifikat';

/**
 * Moving a momsfordran off the skuldkontot at bokslutet.
 *
 * 2650 Redovisningskonto för moms carries the net of the period's moms. A
 * credit balance is a debt to Skatteverket; a debit balance is the opposite -
 * money Skatteverket owes, which is a fordran and belongs among the assets on
 * 1650 Momsfordran (BAS-kontoplanens egna definitioner av de två kontona).
 *
 * It matters at bokslutet because the förenklade årsbokslutet and the
 * NE-bilaga keep the two sides apart: a fordran left on 2650 turns up as a
 * negative amount in B14 Skatteskulder, where the form expects a debt. The
 * amount is the same either way and the result is untouched - this moves a
 * figure to the side of the balance sheet it belongs on.
 */
export const REDOVISNINGSKONTO_MOMS: Kontonummer = kontonummer('2650');
export const MOMSFORDRAN: Kontonummer = kontonummer('1650');

export interface Momsomforing {
  readonly fran: Kontonummer;
  readonly till: Kontonummer;
  /** Always positive: what is moved from the skuldkontot to the fordran. */
  readonly belopp: Ore;
}

/**
 * The omföring a year's closing balances call for, or undefined when they
 * call for none - which is the normal case, since a momsskuld stays where it
 * is.
 */
export function foreslaMomsomforing(
  saldon: ReadonlyMap<Kontonummer, Kontosaldo>,
  redovisningskonto: Kontonummer = REDOVISNINGSKONTO_MOMS,
  fordringskonto: Kontonummer = MOMSFORDRAN,
): Momsomforing | undefined {
  const saldo = saldon.get(redovisningskonto)?.utgaende;
  // A debit balance is positive in the ledger's signs. Zero and credit
  // balances are left alone.
  if (saldo === undefined || isZero(saldo) || saldo < 0) {
    return undefined;
  }
  return { fran: redovisningskonto, till: fordringskonto, belopp: saldo };
}

/** Debits the fordran and credits the skuldkontot: the balance moves, nothing else. */
export function momsomforingskonteringar(omforing: Momsomforing): readonly Kontering[] {
  return [
    { konto: omforing.till, belopp: omforing.belopp },
    { konto: omforing.fran, belopp: negate(omforing.belopp) },
  ];
}
