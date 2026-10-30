import type { Bokprofil } from '../domain/bok/bokprofil';
import { skapaKonto, type Kontoutkast } from '../domain/konto/konto';
import { rakenskapsarsid, skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datumAv, delar, type Datum } from '../domain/tid/datum';
import type { Klocka } from '../domain/tid/klocka';
import type { Handelse } from '../domain/handelse/handelse';
import { kontonummer } from '../domain/konto/konto';
import { lasBokprofil } from './bokidentitet';
import { lasLogg, lasTillstand } from './bokforing';
import type { KonteraDatabase } from './db';
import { skrivKonto, skrivRakenskapsar, type Skrivkontext } from './kommandon';
import {
  HANDELSE_TABLE,
  KONTO_TABLE,
  MALL_TABLE,
  RAKENSKAPSAR_TABLE,
  SYNKKO_TABLE,
} from './schema';

/**
 * The accounts a new ledger starts with: what the booking questions, the
 * year-end items and the default payment methods book on, and nothing more.
 *
 * Not a full chart of accounts. Anyone with history brings their own through
 * a SIE import, which carries their names and their SRU codes; an account
 * already there by number is never touched. The numbers and names are BAS
 * K1 2018's, the chart BAS publishes for enskilda näringsidkare with a
 * förenklat årsbokslut, free of charge and stated to be the basis for the
 * charts in bookkeeping programs. 3740 is not in K1 but is where öres- and
 * kronutjämning lands, and 2650 is the momsredovisning's own account.
 */
export const GRUNDKONTON: readonly Kontoutkast[] = [
  { nummer: '1220', namn: 'Maskiner och inventarier' },
  { nummer: '1221', namn: 'Årets nyanskaffning av maskiner och inventarier' },
  { nummer: '1222', namn: 'Årets ersättning för maskiner och inventarier' },
  { nummer: '1229', namn: 'Årets avskrivningar på maskiner och inventarier' },
  { nummer: '1400', namn: 'Lager' },
  { nummer: '1500', namn: 'Kundfordringar' },
  { nummer: '1600', namn: 'Övriga fordringar' },
  { nummer: '1700', namn: 'Förskott till leverantörer' },
  { nummer: '1910', namn: 'Kassa' },
  { nummer: '1930', namn: 'Företagskonto/checkkonto/affärskonto' },
  { nummer: '2010', namn: 'Eget kapital' },
  { nummer: '2012', namn: 'Avräkning för skatter och avgifter (skattekonto)' },
  { nummer: '2013', namn: 'Övriga egna uttag' },
  { nummer: '2017', namn: 'Egna insättningar' },
  { nummer: '2019', namn: 'Årets resultat, delägare 1' },
  { nummer: '2350', namn: 'Skulder till kreditinstitut' },
  { nummer: '2440', namn: 'Leverantörsskulder' },
  { nummer: '2611', namn: 'Utgående moms på försäljning inom Sverige, 25 %' },
  { nummer: '2621', namn: 'Utgående moms på försäljning inom Sverige, 12 %' },
  { nummer: '2631', namn: 'Utgående moms på försäljning inom Sverige, 6 %' },
  { nummer: '2641', namn: 'Debiterad ingående moms' },
  { nummer: '2650', namn: 'Redovisningskonto för moms' },
  { nummer: '2900', namn: 'Övriga skulder' },
  {
    nummer: '3000',
    namn: 'Försäljning och utfört arbete samt övriga momspliktiga intäkter',
  },
  { nummer: '3740', namn: 'Öres- och kronutjämning' },
  { nummer: '3900', namn: 'Övriga rörelseintäkter' },
  { nummer: '3980', namn: 'Erhållna bidrag' },
  { nummer: '4000', namn: 'Varor' },
  { nummer: '4900', namn: 'Förändring av lager' },
  { nummer: '5100', namn: 'Fastighetskostnader' },
  { nummer: '5400', namn: 'Förbrukningsinventarier och förbrukningsmaterial' },
  { nummer: '5500', namn: 'Reparation och underhåll' },
  { nummer: '5600', namn: 'Kostnader för transportmedel' },
  { nummer: '5611', namn: 'Drivmedel för personbilar' },
  { nummer: '5612', namn: 'Försäkring och skatt för personbilar' },
  { nummer: '5613', namn: 'Reparation och underhåll av personbilar' },
  { nummer: '5700', namn: 'Frakter och transporter' },
  { nummer: '5800', namn: 'Resekostnader' },
  { nummer: '5900', namn: 'Reklam och PR' },
  { nummer: '6100', namn: 'Kontorsmateriel och trycksaker' },
  { nummer: '6200', namn: 'Tele och post' },
  { nummer: '6310', namn: 'Företagsförsäkringar' },
  { nummer: '6500', namn: 'Övriga externa tjänster' },
  { nummer: '6900', namn: 'Övriga kostnader' },
  { nummer: '6980', namn: 'Föreningsavgifter' },
  { nummer: '7830', namn: 'Avskrivningar på maskiner och inventarier' },
  { nummer: '8310', namn: 'Ränteintäkter och utdelningar', typ: 'intakt' },
  { nummer: '8410', namn: 'Räntekostnader för skulder', typ: 'kostnad' },
  { nummer: '8999', namn: 'Årets resultat', typ: 'kostnad' },
];

/**
 * The accounts a new association's book starts with: what its booking
 * questions (src/domain/beslutstrad/foreningstrad.ts) book on, and nothing
 * more.
 *
 * The numbers follow the kontoplan of an association that has kept its books
 * in a program for ideella föreningar, so that a book started from this set and
 * one imported from such a program use the same numbers for the same things;
 * the names are our own. BAS publishes no kontoplan for ideella föreningar
 * (bas.se lists one for everyone but K1 and one for K1, which is for
 * enskilda näringsidkare), so nothing here claims to be BAS's. An account
 * already in the book by number is left as it is, which is how an imported
 * kontoplan keeps its own names.
 *
 * Two numbers are fixed by the booking engine and not by that kontoplan:
 * 3740 Öres- och kronutjämning, where every receipt's rounding goes, and
 * 3010 Försäljning, so that sales stay apart from the other verksamhetsintäkter
 * in bilaga 2 of BFNAR 2010:1.
 */
export const FORENINGENS_GRUNDKONTON: readonly Kontoutkast[] = [
  { nummer: '1110', namn: 'Byggnader' },
  { nummer: '1118', namn: 'Ackumulerade avskrivningar på byggnader' },
  { nummer: '1220', namn: 'Inventarier' },
  { nummer: '1228', namn: 'Ackumulerade avskrivningar på inventarier' },
  { nummer: '1510', namn: 'Kundfordringar' },
  { nummer: '1600', namn: 'Övriga fordringar' },
  { nummer: '1910', namn: 'Kassa' },
  { nummer: '1930', namn: 'Bank' },
  { nummer: '1940', namn: 'Placeringskonto' },
  { nummer: '2010', namn: 'Eget kapital, balanserat' },
  { nummer: '2019', namn: 'Årets över- eller underskott' },
  { nummer: '2399', namn: 'Lån, till exempel fastighetslån' },
  { nummer: '2440', namn: 'Leverantörsskulder' },
  { nummer: '2900', namn: 'Övriga skulder' },
  { nummer: '3010', namn: 'Försäljning' },
  { nummer: '3320', namn: 'Intäkter från lotterier' },
  { nummer: '3610', namn: 'Medlemsavgifter' },
  { nummer: '3710', namn: 'Bidrag från kommun och stat' },
  { nummer: '3720', namn: 'Gåvor och privata bidrag' },
  { nummer: '3730', namn: 'Bidrag från EU' },
  { nummer: '3740', namn: 'Öres- och kronutjämning' },
  { nummer: '3811', namn: 'Uthyrning av lokaler' },
  { nummer: '3990', namn: 'Övriga ersättningar och intäkter' },
  { nummer: '4010', namn: 'Inköp av material och varor' },
  { nummer: '5020', namn: 'El' },
  { nummer: '5030', namn: 'Värme' },
  { nummer: '5040', namn: 'Bredband' },
  { nummer: '5050', namn: 'Vatten och avlopp' },
  { nummer: '5060', namn: 'Sophämtning' },
  { nummer: '5070', namn: 'Reparation och underhåll' },
  { nummer: '5193', namn: 'Fastighetsskötsel och förvaltning' },
  { nummer: '5410', namn: 'Förbrukningsinventarier' },
  { nummer: '5700', namn: 'Frakter och transporter' },
  { nummer: '6110', namn: 'Kontorsmaterial' },
  { nummer: '6150', namn: 'Trycksaker' },
  { nummer: '6230', namn: 'Telefon och internet' },
  { nummer: '6250', namn: 'Porto' },
  { nummer: '6310', namn: 'Försäkringar' },
  { nummer: '6320', namn: 'Avgifter till andra organisationer' },
  { nummer: '6390', namn: 'Övriga kostnader' },
  { nummer: '6570', namn: 'Bankkostnader' },
  { nummer: '8300', namn: 'Ränteintäkter', typ: 'intakt' },
  { nummer: '8400', namn: 'Räntekostnader', typ: 'kostnad' },
  { nummer: '8999', namn: 'Årets resultat', typ: 'kostnad' },
];

/** The starter accounts a book of this kind begins with. */
export function grundkontonFor(profil: Bokprofil): readonly Kontoutkast[] {
  return profil === 'forening' ? FORENINGENS_GRUNDKONTON : GRUNDKONTON;
}

/**
 * The accounts earlier versions started a ledger with.
 *
 * Kept so that a device set up by one of them, and never used, is still
 * recognised as holding nothing but its starter set.
 */
const TIDIGARE_GRUNDKONTON: readonly Kontoutkast[] = [
  { nummer: '1400', namn: 'Lager' },
  { nummer: '1510', namn: 'Kundfordringar' },
  { nummer: '1630', namn: 'Avräkning för skatter och avgifter (skattekonto)' },
  { nummer: '1680', namn: 'Andra kortfristiga fordringar' },
  { nummer: '1790', namn: 'Övriga förutbetalda kostnader och upplupna intäkter' },
  { nummer: '1910', namn: 'Kassa' },
  { nummer: '1930', namn: 'Företagskonto' },
  { nummer: '2013', namn: 'Eget uttag och egen insättning' },
  { nummer: '2440', namn: 'Leverantörsskulder' },
  { nummer: '2610', namn: 'Utgående moms 25 %' },
  { nummer: '2640', namn: 'Ingående moms' },
  { nummer: '2650', namn: 'Redovisningskonto för moms' },
  { nummer: '2990', namn: 'Övriga upplupna kostnader och förutbetalda intäkter' },
  { nummer: '3010', namn: 'Försäljning' },
  { nummer: '3740', namn: 'Öres- och kronutjämning' },
  { nummer: '4010', namn: 'Inköp av material och varor' },
  { nummer: '4990', namn: 'Lagerförändring' },
  { nummer: '5400', namn: 'Förbrukningsinventarier och förbrukningsmaterial' },
  { nummer: '5420', namn: 'Programvaror' },
  { nummer: '6590', namn: 'Övriga externa tjänster' },
  { nummer: '6981', namn: 'Föreningsavgifter' },
  { nummer: '8310', namn: 'Ränteintäkter', typ: 'intakt' },
  { nummer: '8410', namn: 'Räntekostnader', typ: 'kostnad' },
];

/**
 * The templates earlier versions started a ledger with, before booking went
 * by questions (src/domain/beslutstrad), in both the accounts they used.
 *
 * Nothing creates them any more. They are kept so that a device set up by
 * one of those versions, and never used, is still recognised as holding
 * nothing but its starter set.
 */
const TIDIGARE_GRUNDMALLAR: readonly {
  readonly namn: string;
  readonly konto: string;
  readonly momssats: number;
}[] = [
  { namn: 'Inköp av foder', konto: '4010', momssats: 25 },
  { namn: 'Inköp av foder', konto: '4000', momssats: 25 },
  { namn: 'Förbrukningsmaterial', konto: '5400', momssats: 25 },
  { namn: 'Drivmedel', konto: '5400', momssats: 25 },
  { namn: 'Drivmedel', konto: '5600', momssats: 25 },
  { namn: 'Programvara', konto: '5420', momssats: 25 },
  { namn: 'Programvara', konto: '5400', momssats: 25 },
  { namn: 'Tjänst eller analys', konto: '6590', momssats: 25 },
  { namn: 'Tjänst eller analys', konto: '6500', momssats: 25 },
  { namn: 'Föreningsavgift', konto: '6981', momssats: 0 },
  { namn: 'Föreningsavgift', konto: '6980', momssats: 0 },
  { namn: 'Försäljning', konto: '3010', momssats: 25 },
  { namn: 'Försäljning', konto: '3000', momssats: 25 },
];

export interface Uppstartsresultat {
  readonly rakenskapsarSkapat: boolean;
  readonly kontonSkapade: number;
}

/**
 * Makes an empty database ready to book in.
 *
 * Idempotent throughout: nothing is created that already exists, so this can
 * run at every start. An account already there by number is left as it is,
 * so imported books keep their own names.
 */
export async function forberedBokforing(
  db: KonteraDatabase,
  kontext: Skrivkontext,
  klocka: Klocka,
): Promise<Uppstartsresultat> {
  const tillstand = await lasTillstand(db);
  const idag = klocka.idag();

  let rakenskapsarSkapat = false;
  const harAr = [...tillstand.rakenskapsar.values()].some(
    (ar) => idag >= ar.start && idag <= ar.slut,
  );
  if (!harAr) {
    await skrivRakenskapsar(
      db,
      kontext,
      /*
       * The identifier comes from the date rather than from the clock: two
       * devices that both start out empty both create "the year that covers
       * today", and two random identifiers for one calendar year become two
       * years the moment their logs meet.
       */
      skapaRakenskapsar({
        id: rakenskapsarsid(kalenderar(idag).start),
        ...kalenderar(idag),
      }),
    );
    rakenskapsarSkapat = true;
  }

  let kontonSkapade = 0;
  for (const utkast of grundkontonFor(await lasBokprofil(db))) {
    if (tillstand.konton.has(kontonummer(utkast.nummer))) {
      continue;
    }
    await skrivKonto(db, kontext, skapaKonto(utkast));
    kontonSkapade += 1;
  }

  return { rakenskapsarSkapat, kontonSkapade };
}

/**
 * Whether a log holds nothing but what {@link forberedBokforing} writes.
 *
 * That is a device nobody has used: it started, made itself ready to book,
 * and has not been touched since. Such a device joining a sync server that
 * already holds books has nothing of its own to contribute, and everything it
 * would send competes with the real books - see src/data/synk.ts.
 *
 * Matched on content, not only on entry type. An account or template someone
 * created by hand on the new device is work, and work is never thrown away.
 */
export function arEnbartStartdata(logg: readonly Handelse[]): boolean {
  return logg.every((handelse) => {
    switch (handelse.typ) {
      case 'rakenskapsar.skapat':
        return (
          handelse.rakenskapsar.ingaendeBalanser.length === 0 &&
          !handelse.rakenskapsar.avslutat &&
          handelse.rakenskapsar.momslastTom === undefined
        );
      case 'konto.skapat':
        return [...GRUNDKONTON, ...FORENINGENS_GRUNDKONTON, ...TIDIGARE_GRUNDKONTON].some(
          (grund) =>
            grund.nummer === handelse.konto.nummer && grund.namn === handelse.konto.namn,
        );
      case 'mall.sparad':
        return TIDIGARE_GRUNDMALLAR.some(
          (grund) =>
            grund.namn === handelse.mall.namn &&
            grund.konto === handelse.mall.konto &&
            grund.momssats === handelse.mall.momssats &&
            handelse.mall.standardbelopp === undefined,
        );
      default:
        return false;
    }
  });
}

/**
 * Whether this device holds nothing but its own starter set, none of it
 * sent anywhere.
 *
 * The test for a device nobody has used, which is the only kind that may
 * give up what it holds when real books arrive. Everything queued means
 * nothing has left the device; the content check is {@link arEnbartStartdata}.
 */
export async function harEnbartOskickadStartdata(db: KonteraDatabase): Promise<boolean> {
  const logg = await lasLogg(db);
  const kade = await db.table(SYNKKO_TABLE).count();
  return logg.length > 0 && kade === logg.length && arEnbartStartdata(logg);
}

/**
 * Removes the starter set from a device, entries and all.
 *
 * Only ever called after {@link harEnbartOskickadStartdata} has said yes: the
 * entries never left the device and record nothing anyone did. The tables
 * the starter set writes are the only ones touched.
 */
export async function slappStartdata(db: KonteraDatabase): Promise<void> {
  const tabeller = [
    HANDELSE_TABLE,
    SYNKKO_TABLE,
    KONTO_TABLE,
    RAKENSKAPSAR_TABLE,
    MALL_TABLE,
  ];
  await db.transaction(
    'rw',
    tabeller.map((namn) => db.table(namn)),
    async () => {
      for (const namn of tabeller) {
        await db.table(namn).clear();
      }
    },
  );
}

/** The calendar year around a date, which is the fiscal year here. */
function kalenderar(idag: Datum): { start: Datum; slut: Datum } {
  const { ar } = delar(idag);
  return { start: datumAv(ar, 1, 1), slut: datumAv(ar, 12, 31) };
}
