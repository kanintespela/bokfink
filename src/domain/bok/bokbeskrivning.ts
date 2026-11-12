import type { Momsperiod } from '../moms/period';
import type { Redovisningsmetod } from '../moms/redovisningsmetod';
import { BOKPROFILER, type Bokprofil } from './bokprofil';
import { BRANSCHER, type Bransch } from './bransch';

/**
 * What a book says about itself to a device that is about to join it.
 *
 * The log carries the bookkeeping, but not what kind of book it is kept in:
 * the name, the profile and a few settings live in each device's own
 * metadata. A device reading the log alone would open an association's books
 * as a firm's, under a name of its own making. So the book leaves this
 * description beside its log on the sync server, and a joining device starts
 * from it.
 *
 * Only what decides how the book is kept. Nothing that belongs to the device
 * (its verifikatserie, its login) and nothing that identifies a person.
 */
export interface Bokbeskrivning {
  readonly namn: string;
  readonly profil: Bokprofil;
  /** The settings below are present only where the book has made a choice. */
  readonly bransch?: Bransch;
  readonly momsperiod?: Momsperiod;
  readonly momsregistrerad?: boolean;
  readonly redovisningsmetod?: Redovisningsmetod;
}

const MOMSPERIODER: readonly Momsperiod[] = ['manad', 'kvartal', 'ar'];
const REDOVISNINGSMETODER: readonly Redovisningsmetod[] = [
  'kontantmetoden',
  'faktureringsmetoden',
];

export class OlasligBokbeskrivningError extends Error {
  constructor(meddelande: string) {
    super(meddelande);
    this.name = 'OlasligBokbeskrivningError';
  }
}

/**
 * The description as text, the same text for the same description.
 *
 * The keys are written in a fixed order so that two devices describing the
 * same book produce the same string, and a device can tell whether what it
 * last sent is still true by comparing strings.
 */
export function skrivBokbeskrivning(beskrivning: Bokbeskrivning): string {
  return JSON.stringify({
    namn: beskrivning.namn,
    profil: beskrivning.profil,
    ...(beskrivning.bransch === undefined ? {} : { bransch: beskrivning.bransch }),
    ...(beskrivning.momsperiod === undefined
      ? {}
      : { momsperiod: beskrivning.momsperiod }),
    ...(beskrivning.momsregistrerad === undefined
      ? {}
      : { momsregistrerad: beskrivning.momsregistrerad }),
    ...(beskrivning.redovisningsmetod === undefined
      ? {}
      : { redovisningsmetod: beskrivning.redovisningsmetod }),
  });
}

/**
 * Reads a description that came from a server, trusting none of it.
 *
 * A profile or a setting this version does not know is refused rather than
 * dropped: joining an association's books as a firm's, or a book kept with
 * faktureringsmetoden as one kept with kontantmetoden, is worse than not
 * joining it (hard rule 11).
 */
export function tolkaBokbeskrivning(text: string): Bokbeskrivning {
  let varde: unknown;
  try {
    varde = JSON.parse(text);
  } catch {
    throw new OlasligBokbeskrivningError(
      'Bokens beskrivning på servern går inte att läsa.',
    );
  }
  if (varde === null || typeof varde !== 'object' || Array.isArray(varde)) {
    throw new OlasligBokbeskrivningError(
      'Bokens beskrivning på servern går inte att läsa.',
    );
  }
  const falt = varde as Record<string, unknown>;

  const namn = typeof falt['namn'] === 'string' ? falt['namn'].trim() : '';
  if (namn === '') {
    throw new OlasligBokbeskrivningError('Boken på servern saknar namn.');
  }

  return {
    namn,
    profil: enAv('profil', falt['profil'], BOKPROFILER),
    ...valfri('bransch', falt['bransch'], BRANSCHER),
    ...valfri('momsperiod', falt['momsperiod'], MOMSPERIODER),
    ...valfri('redovisningsmetod', falt['redovisningsmetod'], REDOVISNINGSMETODER),
    ...(falt['momsregistrerad'] === undefined
      ? {}
      : { momsregistrerad: sanningsvarde(falt['momsregistrerad']) }),
  };
}

function enAv<T extends string>(falt: string, varde: unknown, tillatna: readonly T[]): T {
  const funnen = tillatna.find((kandidat) => kandidat === varde);
  if (funnen === undefined) {
    throw new OlasligBokbeskrivningError(
      `Boken på servern har ${falt} "${String(varde)}", som den här versionen av ` +
        'Bokfink inte känner till. Uppdatera appen och försök igen.',
    );
  }
  return funnen;
}

function valfri<K extends string, T extends string>(
  falt: K,
  varde: unknown,
  tillatna: readonly T[],
): Partial<Record<K, T>> {
  return varde === undefined
    ? {}
    : ({ [falt]: enAv(falt, varde, tillatna) } as Record<K, T>);
}

function sanningsvarde(varde: unknown): boolean {
  if (typeof varde !== 'boolean') {
    throw new OlasligBokbeskrivningError(
      'Bokens beskrivning på servern säger inte tydligt om boken är momsregistrerad.',
    );
  }
  return varde;
}
