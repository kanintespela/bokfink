import { arGiltigtRutval, type Resultatrad } from '../domain/bokslut/forenkladArsbokslut';
import { kontonummer, type Kontonummer } from '../domain/konto/konto';
import type { KonteraDatabase } from './db';

const NYCKEL = 'bokslut.rutval';

/**
 * The box the user chose for each account BAS allows in two, remembered
 * across years and devices.
 *
 * Kept as metadata rather than as an event: it decides where a figure goes
 * on the form, never what the books say, and metadata already travels with
 * a backup. The choice is about the business rather than the year - a
 * business with only momspliktig sales puts 3740 öresutjämning in R1 every
 * year - so one choice per account covers every year.
 *
 * A stored entry that is no longer a valid choice (a hand-edited backup, or
 * a future change to the BAS table) is left out. The account then asks for
 * a choice again on the bokslut screen, which is where the user would notice.
 */
export async function lasRutval(
  db: KonteraDatabase,
): Promise<ReadonlyMap<Kontonummer, Resultatrad>> {
  const sparat = await db.getMeta<Record<string, string>>(NYCKEL);
  const val = new Map<Kontonummer, Resultatrad>();
  for (const [text, rad] of Object.entries(sparat ?? {})) {
    let konto: Kontonummer;
    try {
      konto = kontonummer(text);
    } catch {
      continue;
    }
    if (arGiltigtRutval(konto, rad as Resultatrad)) {
      val.set(konto, rad as Resultatrad);
    }
  }
  return val;
}

/** Sets or, with `rad` undefined, forgets the choice for one account. */
export async function sparaRutval(
  db: KonteraDatabase,
  konto: Kontonummer,
  rad: Resultatrad | undefined,
): Promise<void> {
  if (rad !== undefined && !arGiltigtRutval(konto, rad)) {
    throw new TypeError(`Konto ${konto} kan inte placeras i ruta ${rad}.`);
  }
  const val = new Map(await lasRutval(db));
  if (rad === undefined) {
    val.delete(konto);
  } else {
    val.set(konto, rad);
  }
  await db.setMeta(NYCKEL, Object.fromEntries(val));
}
