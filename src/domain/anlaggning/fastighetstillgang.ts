import { add, delaOchAvrunda, isZero, subtract, ZERO, type Ore } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import { jamfor, type Datum } from '../tid/datum';
import {
  BYGGNADSPROCENT,
  MARKANLAGGNINGSPROCENT,
  type Byggnadstyp,
  type Markanlaggningstyp,
} from './byggnadsprocentsatser';

/**
 * Byggnader, markanläggningar, mark och skog - skrivs av individuellt, till
 * skillnad från maskiner och inventarier (se avskrivning.ts), som skrivs av
 * kollektivt. Var sak för sig, med sin egen procentsats, sitt eget bokförda
 * värde och sin egen vinst eller förlust vid avyttring (BFN K1 punkt 6.16).
 *
 * Skog hålls till anskaffningsvärde utan ordinarie avskrivning, precis som
 * mark. Skogsavdrag (IL 21 kap.) - en separat avdragsrätt som blir aktuell
 * först när virke faktiskt säljs - är inte byggt här; att gissa på den
 * mekaniken innan den behövs är mer sannolikt att bli fel än att vänta.
 */
export type Fastighetskategori =
  | { readonly typ: 'byggnad'; readonly byggnadstyp: Byggnadstyp }
  | { readonly typ: 'markanlaggning'; readonly markanlaggningstyp: Markanlaggningstyp }
  | { readonly typ: 'mark' }
  | { readonly typ: 'skog' };

export interface Fastighetsavyttring {
  readonly datum: Datum;
  readonly typ: 'forsaljning' | 'utrangering';
  /** Zero for an utrangering - nothing was sold, so nothing came back. */
  readonly forsaljningsinkomst: Ore;
}

export interface Fastighetstillgang {
  readonly id: Uuid;
  readonly benamning: string;
  readonly anskaffningsdatum: Datum;
  readonly anskaffningsvarde: Ore;
  readonly kategori: Fastighetskategori;
  /**
   * Vad som redan är avskrivet. Noll för en tillgång som registreras när den
   * köps; ett positivt belopp när registret sätts upp för en tillgång som
   * redan skrivits av i tidigare bokföring (t.ex. vid migrering av historik).
   */
  readonly ackumuleradAvskrivning: Ore;
  readonly avyttring?: Fastighetsavyttring;
}

export interface Fastighetstillgangsuppgifter {
  readonly id: Uuid;
  readonly benamning: string;
  readonly anskaffningsdatum: Datum;
  readonly anskaffningsvarde: Ore;
  readonly kategori: Fastighetskategori;
  /** Utelämnas för en nyanskaffad tillgång - då är den noll. */
  readonly ackumuleradAvskrivning?: Ore;
}

export function skapaFastighetstillgang(
  uppgifter: Fastighetstillgangsuppgifter,
): Fastighetstillgang {
  const benamning = uppgifter.benamning.trim();
  if (benamning === '') {
    throw new TypeError('En fastighetstillgång måste ha en benämning.');
  }
  if (uppgifter.anskaffningsvarde <= 0) {
    throw new RangeError(
      `Anskaffningsvärdet måste vara större än noll, fick ${uppgifter.anskaffningsvarde} öre.`,
    );
  }
  const ackumuleradAvskrivning = uppgifter.ackumuleradAvskrivning ?? ZERO;
  if (
    ackumuleradAvskrivning < ZERO ||
    ackumuleradAvskrivning > uppgifter.anskaffningsvarde
  ) {
    throw new RangeError(
      `Ackumulerad avskrivning (${ackumuleradAvskrivning} öre) måste ligga mellan noll och ` +
        `anskaffningsvärdet (${uppgifter.anskaffningsvarde} öre).`,
    );
  }

  return {
    id: uppgifter.id,
    benamning,
    anskaffningsdatum: uppgifter.anskaffningsdatum,
    anskaffningsvarde: uppgifter.anskaffningsvarde,
    kategori: uppgifter.kategori,
    ackumuleradAvskrivning,
  };
}

/** Punkt 6.14 (byggnad), 6.15 (markanläggning), 6.18/6.26 (mark/skog: aldrig). */
export function arligAvskrivningsprocent(kategori: Fastighetskategori): number {
  switch (kategori.typ) {
    case 'byggnad':
      return BYGGNADSPROCENT[kategori.byggnadstyp];
    case 'markanlaggning':
      return MARKANLAGGNINGSPROCENT[kategori.markanlaggningstyp];
    case 'mark':
    case 'skog':
      return 0;
  }
}

/**
 * Årets avskrivning: anskaffningsvärdet gånger procentsatsen, rakt av varje
 * år (linjär, inte degressiv som den kollektiva potten) - men aldrig mer än
 * vad som återstår att skriva av, så det bokförda värdet aldrig blir
 * negativt.
 */
export function arsAvskrivning(
  tillgang: Pick<Fastighetstillgang, 'anskaffningsvarde' | 'kategori'>,
  ackumuleradAvskrivning: Ore,
): Ore {
  const procent = arligAvskrivningsprocent(tillgang.kategori);
  if (procent === 0) {
    return ZERO;
  }

  const arlig = delaOchAvrunda(tillgang.anskaffningsvarde * procent, 100);
  const kvarvarande = subtract(tillgang.anskaffningsvarde, ackumuleradAvskrivning);
  return arlig < kvarvarande ? arlig : kvarvarande;
}

export function bokfortVarde(
  tillgang: Pick<Fastighetstillgang, 'anskaffningsvarde'>,
  ackumuleradAvskrivning: Ore,
): Ore {
  return subtract(tillgang.anskaffningsvarde, ackumuleradAvskrivning);
}

/**
 * Vinst (positivt) eller förlust (negativt), punkt 6.16: skillnaden mellan
 * försäljningsinkomsten och det bokförda värdet - individuellt per tillgång,
 * till skillnad från den kollektiva potten där realisationsresultatet bakas
 * in i avskrivningen.
 */
export function forsaljningsresultat(bokfortVarde: Ore, forsaljningsinkomst: Ore): Ore {
  return subtract(forsaljningsinkomst, bokfortVarde);
}

export class ForMycketAvskrivetError extends Error {
  constructor(benamning: string, forsok: Ore, kvarvarande: Ore) {
    super(
      `Kan inte skriva av ${forsok} öre till på "${benamning}" - endast ${kvarvarande} öre ` +
        'återstår att skriva av.',
    );
    this.name = 'ForMycketAvskrivetError';
  }
}

/**
 * Lägger årets bokförda avskrivning till det som redan är avskrivet.
 *
 * Till skillnad från den kollektiva potten (där ackumulerad avskrivning
 * läses ur liggaren) är det här registret själva källan, eftersom varje
 * fastighetskomponent skrivs av för sig - så varje bokning måste synas i
 * registret för att nästa års beräkning ska ha rätt underlag.
 */
export function bokforAvskrivningPaFastighet(
  tillgang: Fastighetstillgang,
  belopp: Ore,
): Fastighetstillgang {
  const kvarvarande = subtract(
    tillgang.anskaffningsvarde,
    tillgang.ackumuleradAvskrivning,
  );
  if (belopp > kvarvarande) {
    throw new ForMycketAvskrivetError(tillgang.benamning, belopp, kvarvarande);
  }
  return {
    ...tillgang,
    ackumuleradAvskrivning: add(tillgang.ackumuleradAvskrivning, belopp),
  };
}

export class RedanAvyttradFastighetError extends Error {
  constructor(benamning: string) {
    super(`"${benamning}" är redan avyttrad och kan inte avyttras en gång till.`);
    this.name = 'RedanAvyttradFastighetError';
  }
}

export function avyttraFastighet(
  tillgang: Fastighetstillgang,
  avyttring: Fastighetsavyttring,
): Fastighetstillgang {
  if (tillgang.avyttring !== undefined) {
    throw new RedanAvyttradFastighetError(tillgang.benamning);
  }
  if (jamfor(avyttring.datum, tillgang.anskaffningsdatum) < 0) {
    throw new RangeError(
      `"${tillgang.benamning}" kan inte avyttras ${avyttring.datum}, före sitt eget ` +
        `anskaffningsdatum ${tillgang.anskaffningsdatum}.`,
    );
  }
  if (avyttring.typ === 'utrangering' && !isZero(avyttring.forsaljningsinkomst)) {
    throw new RangeError(
      'En utrangering har ingen försäljningsinkomst - använd "forsaljning" om ' +
        'tillgången faktiskt gav något tillbaka.',
    );
  }

  return { ...tillgang, avyttring };
}
