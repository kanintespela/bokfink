import {
  arGiltigtRadval,
  beraknaForeningsbokslut,
  type Foreningsbokslut,
  type Foreningsrad,
} from '../domain/bokslut/foreningsbokslut';
import { kontonummer, type Kontonummer } from '../domain/konto/konto';
import { omfattar, type Rakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { beraknaSaldon } from '../domain/rapport/saldon';
import { addDagar } from '../domain/tid/datum';
import type { KonteraDatabase } from './db';
import { foreningskapitalFor } from './foreningskapital';
import { lasTillstand } from './bokforing';
import type { Foreningskapital } from '../domain/bokslut/foreningskapital';

const RADVAL_NYCKEL = 'bokslut.foreningsradval';
const STYRELSE_NYCKEL = 'bokslut.styrelse';

/**
 * The post the association put each account on, where it differs from the
 * default (bilaga 2 gives no kontoplan, so the placement is its own call).
 *
 * Metadata like the firm's box choices: it decides where a figure goes on the
 * form and never what the books say, and it follows a backup. One choice per
 * account serves every year, since an account means the same thing each year.
 * An entry that is no longer a valid choice is left out, and the account is
 * then shown with the default again.
 */
export async function lasRadval(
  db: KonteraDatabase,
): Promise<ReadonlyMap<Kontonummer, Foreningsrad>> {
  const sparat = await db.getMeta<Record<string, string>>(RADVAL_NYCKEL);
  const val = new Map<Kontonummer, Foreningsrad>();
  for (const [text, rad] of Object.entries(sparat ?? {})) {
    let konto: Kontonummer;
    try {
      konto = kontonummer(text);
    } catch {
      continue;
    }
    if (arGiltigtRadval(konto, rad as Foreningsrad)) {
      val.set(konto, rad as Foreningsrad);
    }
  }
  return val;
}

/** Sets or, with `rad` undefined, forgets the post for one account. */
export async function sparaRadval(
  db: KonteraDatabase,
  konto: Kontonummer,
  rad: Foreningsrad | undefined,
): Promise<void> {
  if (rad !== undefined && !arGiltigtRadval(konto, rad)) {
    throw new TypeError(`Konto ${konto} kan inte placeras på raden ${rad}.`);
  }
  const val = new Map(await lasRadval(db));
  if (rad === undefined) {
    val.delete(konto);
  } else {
    val.set(konto, rad);
  }
  await db.setMeta(RADVAL_NYCKEL, Object.fromEntries(val));
}

/** A board member as the bokslut is signed by. */
export interface Styrelseledamot {
  readonly namn: string;
  readonly roll: string;
}

/**
 * Who signs the bokslut: every board member, each with a date (bilaga 2).
 *
 * Kept in the book and nowhere else: the names are typed here, stay on the
 * device and in the book's backup, and are printed on the signature lines.
 */
export async function lasStyrelse(
  db: KonteraDatabase,
): Promise<readonly Styrelseledamot[]> {
  const sparat = await db.getMeta<readonly Styrelseledamot[]>(STYRELSE_NYCKEL);
  return (sparat ?? []).filter(
    (post) => typeof post.namn === 'string' && typeof post.roll === 'string',
  );
}

export async function sparaStyrelse(
  db: KonteraDatabase,
  styrelse: readonly Styrelseledamot[],
): Promise<void> {
  await db.setMeta(
    STYRELSE_NYCKEL,
    styrelse
      .map((post) => ({ namn: post.namn.trim(), roll: post.roll.trim() }))
      .filter((post) => post.namn !== ''),
  );
}

export interface Foreningsarsbokslut {
  readonly ar: Rakenskapsar;
  readonly aret: Foreningsbokslut;
  /** The year before, for the comparatives every post needs (kapitel 5); none for a first year. */
  readonly foregaendeAr: Rakenskapsar | undefined;
  readonly foregaende: Foreningsbokslut | undefined;
  /** The funds set aside inside eget kapital, for the note, this year and last. */
  readonly kapital: Foreningskapital;
  readonly foregaendeKapital: Foreningskapital | undefined;
}

/**
 * The year and the one before it, each set out on the form.
 *
 * The year before is the räkenskapsår that ended the day before this one
 * began. A year not in the books gives no comparatives rather than made-up
 * ones, and the page says so.
 */
export async function foreningsarsbokslut(
  db: KonteraDatabase,
  ar: Rakenskapsar,
): Promise<Foreningsarsbokslut> {
  const tillstand = await lasTillstand(db);
  const radval = await lasRadval(db);
  const alla = [...tillstand.verifikat.values()];
  const sorterat = (aret: Rakenskapsar) =>
    beraknaForeningsbokslut(
      beraknaSaldon(
        aret.ingaendeBalanser,
        alla.filter((post) => omfattar(aret, post.datum)),
      ),
      radval,
    );

  const dagenFore = addDagar(ar.start, -1);
  const foregaendeAr = [...tillstand.rakenskapsar.values()].find(
    (kandidat) => kandidat.slut === dagenFore,
  );
  return {
    ar,
    aret: sorterat(ar),
    foregaendeAr,
    foregaende: foregaendeAr === undefined ? undefined : sorterat(foregaendeAr),
    kapital: await foreningskapitalFor(db, ar),
    foregaendeKapital:
      foregaendeAr === undefined
        ? undefined
        : await foreningskapitalFor(db, foregaendeAr),
  };
}
