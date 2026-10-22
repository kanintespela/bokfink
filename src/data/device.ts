import type { KonteraDatabase } from './db';
import { newIdentifier } from './id';

const DEVICE_ID_KEY = 'deviceId';

/**
 * A stable identifier for this installation.
 *
 * Synchronisation gives every device its own verifikatserie so that two
 * devices can allocate verification numbers without talking to each other
 * (see docs/UTVECKLINGSPLAN.md, 3.1). That starts here: the identity has to
 * exist before the first verifikat is written, not after.
 */
export async function getOrCreateDeviceId(
  db: KonteraDatabase,
  newId: () => string = newIdentifier,
): Promise<string> {
  const existing = await db.getMeta<string>(DEVICE_ID_KEY);
  if (existing) {
    return existing;
  }

  const created = newId();
  await db.setMeta(DEVICE_ID_KEY, created);
  return created;
}
