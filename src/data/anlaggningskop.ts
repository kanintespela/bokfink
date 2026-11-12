import {
  oregistreradeAnlaggningskop,
  type Anlaggningskop,
} from '../domain/anlaggning/anlaggningskop';
import type { Uuid } from '../domain/id/uuidv7';
import type { Datum } from '../domain/tid/datum';
import { lasTillstand } from './bokforing';
import type { BokfinkDatabase } from './db';

/**
 * The verifikat the user has said are not purchases of an asset.
 *
 * Kept in the book's metadata rather than in the log: it records what this
 * device has stopped asking about, not anything about the books. The other
 * device asks for itself, and a wrong answer here costs a question, not a
 * figure.
 */
const AVFARDADE_NYCKEL = 'anlaggning.ejAnlaggning';

export class OkantVerifikatError extends Error {
  constructor() {
    super('Verifikatet som anläggningen skulle kopplas till finns inte i bokföringen.');
    this.name = 'OkantVerifikatError';
  }
}

/**
 * Refuses a register entry that points at a verifikat the books do not hold.
 *
 * Checked when the entry is made, not when the log is replayed: a link that
 * points nowhere is a mistake to stop at the form, while an entry already in
 * the log has to keep replaying whatever else has happened since.
 */
export async function kravVerifikat(
  db: BokfinkDatabase,
  verifikatId: Uuid | undefined,
): Promise<void> {
  if (verifikatId === undefined) {
    return;
  }
  if (!(await lasTillstand(db)).verifikat.has(verifikatId)) {
    throw new OkantVerifikatError();
  }
}

/**
 * Purchases booked on asset accounts within a period that the register does
 * not hold.
 *
 * The period is the caller's: the screens ask about the fiscal year that is
 * open, so that a set of books imported with ten years of history does not
 * come with ten years of questions.
 */
export async function lasOregistreradeAnlaggningskop(
  db: BokfinkDatabase,
  period: { readonly start: Datum; readonly slut: Datum },
): Promise<Anlaggningskop[]> {
  const tillstand = await lasTillstand(db);
  const registrerade = new Set<Uuid>();
  for (const tillgang of [
    ...tillstand.anlaggningar.values(),
    ...tillstand.fastigheter.values(),
  ]) {
    if (tillgang.verifikatId !== undefined) {
      registrerade.add(tillgang.verifikatId);
    }
  }
  const avfardade = new Set((await db.getMeta<Uuid[]>(AVFARDADE_NYCKEL)) ?? []);

  return oregistreradeAnlaggningskop(
    [...tillstand.verifikat.values()],
    registrerade,
    avfardade,
  )
    .filter(
      ({ verifikat }) =>
        verifikat.datum >= period.start && verifikat.datum <= period.slut,
    )
    .sort(
      (a, b) =>
        a.verifikat.datum.localeCompare(b.verifikat.datum) ||
        a.verifikat.id.localeCompare(b.verifikat.id),
    );
}

/** Stops asking about a verifikat: it was not the purchase of an asset. */
export async function avfardaAnlaggningskop(
  db: BokfinkDatabase,
  verifikatId: Uuid,
): Promise<void> {
  const avfardade = (await db.getMeta<Uuid[]>(AVFARDADE_NYCKEL)) ?? [];
  if (!avfardade.includes(verifikatId)) {
    await db.setMeta(AVFARDADE_NYCKEL, [...avfardade, verifikatId]);
  }
}
