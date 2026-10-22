/**
 * Storage persistence.
 *
 * Safari exempts home-screen PWAs from its seven-day eviction, but data can
 * still be evicted under pressure, and asking for persistence is the only
 * lever the web gives us. It is not a substitute for backups
 * (docs/UTVECKLINGSPLAN.md, section 2).
 */

export type PersistenceState = 'persisted' | 'denied' | 'unsupported';

export async function requestPersistentStorage(): Promise<PersistenceState> {
  if (!navigator.storage?.persist) {
    return 'unsupported';
  }

  // Already granted counts; asking again can prompt the user for nothing.
  if (await navigator.storage.persisted()) {
    return 'persisted';
  }

  return (await navigator.storage.persist()) ? 'persisted' : 'denied';
}

export interface StorageEstimate {
  usedBytes: number;
  quotaBytes: number;
}

export async function estimateStorage(): Promise<StorageEstimate | undefined> {
  if (!navigator.storage?.estimate) {
    return undefined;
  }

  const estimate = await navigator.storage.estimate();
  return {
    usedBytes: estimate.usage ?? 0,
    quotaBytes: estimate.quota ?? 0,
  };
}
