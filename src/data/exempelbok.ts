import { allaLov, lovTillMall, momsForLov } from '../domain/beslutstrad/beslutstrad';
import { kontonummer } from '../domain/konto/konto';
import { tillampaMall } from '../domain/mall/konteringsmall';
import { oreFromKronor } from '../domain/belopp/ore';
import { addDagar, dagarMellan, forstaIAret, type Datum } from '../domain/tid/datum';
import type { Klocka } from '../domain/tid/klocka';
import { skapaUtkast } from '../domain/verifikat/verifikat';
import { verifikatserie } from '../domain/verifikat/serie';
import {
  lasBocker,
  skapaBok,
  type Bok,
  type Bokregister,
  type Registerkontext,
} from './bokregister';
import { BokfinkDatabase } from './db';
import { getOrCreateDeviceId } from './device';
import { newIdentifier } from './id';
import { bokforUtkast, sattSerieForEnhet, type Skrivkontext } from './kommandon';
import { forberedBokforing } from './uppstart';

/** Marks a book as the example, so the app can say so and offer to remove it. */
export const EXEMPEL_NYCKEL = 'exempelbok';

export const EXEMPELBOKENS_NAMN = 'Exempel: Lindgrens Snickeri';

/**
 * What the example firm books, in the order it happened.
 *
 * Invented, and chosen to show the ordinary things: income with 25 % moms,
 * purchases, a cost without moms and the bank's fee. The leaf is the same one
 * the booking questions end in, so the example is booked exactly as a person
 * answering the questions would have booked it.
 */
const POSTER: readonly { lov: string; text: string; kronor: string }[] = [
  { lov: 'smainventarie', text: 'Kapsåg, Bygghandeln', kronor: '4990' },
  { lov: 'salt-tjanst', text: 'Köksluckor, kund Ek', kronor: '18750' },
  { lov: 'material', text: 'Skruv, lim och slippapper', kronor: '1245' },
  { lov: 'salt-tjanst', text: 'Altanbygge, kund Berg', kronor: '42500' },
  { lov: 'bil-drivmedel', text: 'Diesel', kronor: '1180' },
  { lov: 'forsakring', text: 'Företagsförsäkring', kronor: '3420' },
  { lov: 'salt-varor', text: 'Skärbrädor, julmarknad', kronor: '3600' },
  { lov: 'tele', text: 'Mobilabonnemang', kronor: '349' },
  { lov: 'salt-tjanst', text: 'Bokhylla på mått, kund Lund', kronor: '27500' },
  { lov: 'programvara', text: 'Ritprogram, årslicens', kronor: '2388' },
  { lov: 'material', text: 'Ek och björk, Virkeshuset', kronor: '6875' },
  { lov: 'bankavgift', text: 'Bankavgift', kronor: '99' },
  { lov: 'salt-tjanst', text: 'Fönsterbänkar, kund Holm', kronor: '9800' },
  { lov: 'kontorsmaterial', text: 'Visitkort', kronor: '595' },
];

/**
 * Spreads the example over the year so far.
 *
 * From the first of January to today, whichever year that is, so the book
 * always has a year that covers today and never a booking in the future. Early
 * in January that puts several on the same day, which is fine for an example.
 */
function datumFor(index: number, antal: number, idag: Datum): Datum {
  const start = forstaIAret(idag);
  const dagar = dagarMellan(start, idag);
  return addDagar(start, antal <= 1 ? 0 : Math.floor((index * dagar) / (antal - 1)));
}

/** Books the example firm's year in an empty firm's book. */
export async function fyllExempelbok(
  db: BokfinkDatabase,
  kontext: Skrivkontext,
  klocka: Klocka,
): Promise<number> {
  await forberedBokforing(db, kontext, klocka);
  await sattSerieForEnhet(db, verifikatserie('A'));
  await db.setMeta('momsperiod', 'kvartal');
  await db.setMeta(EXEMPEL_NYCKEL, true);

  const idag = klocka.idag();
  const lov = new Map(allaLov().map((kandidat) => [kandidat.id, kandidat]));
  for (const [index, post] of POSTER.entries()) {
    const blad = lov.get(post.lov);
    if (blad === undefined) {
      throw new Error(`Exempelboken använder ett svar som inte finns: ${post.lov}.`);
    }
    const dag = datumFor(index, POSTER.length, idag);
    const mall = lovTillMall(blad, momsForLov(blad, dag).sats);
    await bokforUtkast(
      db,
      kontext,
      skapaUtkast({
        id: newIdentifier(),
        datum: dag,
        beskrivning: post.text,
        konteringar: tillampaMall(mall, {
          brutto: oreFromKronor(post.kronor),
          betalkonto: kontonummer('1930'),
        }),
        mall: mall.id,
      }),
      verifikatserie('A'),
    );
  }
  return POSTER.length;
}

/**
 * Makes the example book, or finds the one made before.
 *
 * Once only: a second press opens the book that is there rather than adding a
 * copy, because the book's name has to be unique and a pile of identical
 * examples is clutter nobody asked for. Whoever removes it can make it again.
 */
export async function skapaExempelbok(
  register: Bokregister,
  registerkontext: Registerkontext,
  klocka: Klocka,
): Promise<Bok> {
  const { bocker } = await lasBocker(register, registerkontext);
  const finns = bocker.find((bok) => bok.namn === EXEMPELBOKENS_NAMN);
  if (finns !== undefined) {
    return finns;
  }

  const bok = await skapaBok(
    register,
    registerkontext,
    EXEMPELBOKENS_NAMN,
    'enskild_firma',
  );
  const db = new BokfinkDatabase(bok.databas);
  try {
    await db.open();
    await fyllExempelbok(
      db,
      {
        enhet: await getOrCreateDeviceId(db),
        nu: () => new Date().toISOString(),
        idag: () => klocka.idag(),
      },
      klocka,
    );
  } finally {
    db.close();
  }
  return bok;
}
