import type {
  Fastighetsrad,
  Inventarierad,
  Registerfil,
} from '../domain/anlaggning/registerfil';
import { registreraAnlaggningstillgang } from './anlaggning';
import { lasTillstand } from './bokforing';
import type { BokfinkDatabase } from './db';
import { registreraFastighetstillgang } from './fastighet';
import type { Skrivkontext } from './kommandon';

/** What reading a register file would do, before anything is done. */
export interface Registerimportplan {
  readonly inventarier: readonly Inventarierad[];
  readonly fastighet: readonly Fastighetsrad[];
  /** Entries the register already holds, by name, which are left alone. */
  readonly finnsRedan: readonly string[];
}

/** The same asset, as far as a file can say: what, when, and for how much. */
const nyckel = (rad: {
  readonly benamning: string;
  readonly anskaffningsdatum: string;
  readonly anskaffningsvarde: number;
}) =>
  `${rad.benamning.toLocaleLowerCase('sv')}|${rad.anskaffningsdatum}|${rad.anskaffningsvarde}`;

/**
 * Sorts a register file into what is new and what is already there.
 *
 * Shown to the user before anything is written (hard rule 10). An entry the
 * register already holds - the same name, date and cost - is skipped, so
 * that reading the same file twice does not give two of everything, and a
 * file can be read again after an asset was added to it.
 */
export async function planeraRegisterimport(
  db: BokfinkDatabase,
  fil: Registerfil,
): Promise<Registerimportplan> {
  const tillstand = await lasTillstand(db);
  const inventarier = new Set([...tillstand.anlaggningar.values()].map(nyckel));
  const fastighet = new Set([...tillstand.fastigheter.values()].map(nyckel));

  const finnsRedan: string[] = [];
  const nya = <T extends Inventarierad | Fastighetsrad>(
    rader: readonly T[],
    befintliga: Set<string>,
  ) =>
    rader.filter((rad) => {
      // Also against the rows before it, so a file that lists one twice gives one.
      if (befintliga.has(nyckel(rad))) {
        finnsRedan.push(rad.benamning);
        return false;
      }
      befintliga.add(nyckel(rad));
      return true;
    });

  return {
    inventarier: nya(fil.inventarier, inventarier),
    fastighet: nya(fil.fastighet, fastighet),
    finnsRedan,
  };
}

/**
 * Registers what a plan says is new, and says how many.
 *
 * Each entry is an ordinary registration, the same event a typed-in one
 * writes, so nothing about an imported asset differs from one entered by
 * hand. The register books nothing: the ledger already has the purchases.
 */
export async function genomforRegisterimport(
  db: BokfinkDatabase,
  kontext: Skrivkontext,
  plan: Registerimportplan,
): Promise<number> {
  for (const rad of plan.inventarier) {
    await registreraAnlaggningstillgang(db, kontext, rad);
  }
  for (const rad of plan.fastighet) {
    await registreraFastighetstillgang(db, kontext, rad);
  }
  return plan.inventarier.length + plan.fastighet.length;
}
