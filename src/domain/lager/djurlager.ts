import { delaOchAvrunda, ore, sum, type Ore } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import type { Datum } from '../tid/datum';

/**
 * Djurlager - djur i jordbruk och renskötsel räknas alltid som
 * lagertillgångar (IL 17 kap. 5 §), aldrig som varulager i vanlig mening,
 * och har en egen värderingsregel: lägst 85 % av den genomsnittliga
 * produktionsutgiften för djurslaget (Skatteverkets årliga föreskrift, se
 * djurproduktionsutgift.ts), men aldrig mer än vad djuren sammanlagt skulle
 * gå att sälja för. Det schablonmässiga 3 %-avdraget och lägsta värdets
 * princip för vanligt varulager (punkt 6.53-6.55) gäller inte här.
 *
 * Modellerad som en årlig inventering, inte som enskilda inköp/uttag - det
 * är så den här verksamheten faktiskt räknar sitt lager (en räkning av
 * djuren vid årets slut), och att bygga spårning av varje enskild
 * transaktion för ett djurslag som bara räknas en gång om året vore mer än
 * vad som behövs.
 */
export interface Djurpost {
  readonly djurslag: string;
  readonly antal: number;
  /** Kr per djur, från Skatteverkets föreskrift eller angivet för hand. */
  readonly genomsnittligProduktionsutgiftPerDjur: Ore;
  /** Vad djuren sammanlagt skulle gå att sälja för, per djur. */
  readonly nettoforsaljningsvardePerDjur: Ore;
}

export interface Djurlagerinventering {
  readonly id: Uuid;
  readonly datum: Datum;
  readonly poster: readonly Djurpost[];
}

function kravAntal(antal: number): void {
  if (!Number.isInteger(antal) || antal < 0) {
    throw new RangeError(
      `Antalet djur måste vara ett icke-negativt heltal, fick ${antal}.`,
    );
  }
}

/**
 * Det lägsta tillåtna värdet per djur: 85 % av produktionsutgiften, men
 * aldrig högre än vad djuret skulle gå att sälja för (IL 17 kap. 5 §).
 */
export function vardePerDjur(post: Djurpost): Ore {
  kravAntal(post.antal);
  const golv = delaOchAvrunda(post.genomsnittligProduktionsutgiftPerDjur * 85, 100);
  return golv < post.nettoforsaljningsvardePerDjur
    ? golv
    : post.nettoforsaljningsvardePerDjur;
}

export function lagervardeForPost(post: Djurpost): Ore {
  return ore(vardePerDjur(post) * post.antal);
}

export function lagervarde(inventering: Djurlagerinventering): Ore {
  return sum(inventering.poster.map(lagervardeForPost));
}

export interface Djurlagerinventeringsuppgifter {
  readonly id: Uuid;
  readonly datum: Datum;
  readonly poster: readonly Djurpost[];
}

export function skapaDjurlagerinventering(
  uppgifter: Djurlagerinventeringsuppgifter,
): Djurlagerinventering {
  for (const post of uppgifter.poster) {
    kravAntal(post.antal);
    if (post.djurslag.trim() === '') {
      throw new TypeError(
        'Varje post i en djurlagerinventering måste ange ett djurslag.',
      );
    }
  }
  return uppgifter;
}
