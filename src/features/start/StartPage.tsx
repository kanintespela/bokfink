import { useEffect, useState } from 'react';

import { getOrCreateDeviceId } from '../../data/device';
import type { KonteraDatabase } from '../../data/db';
import { latestSchemaVersion } from '../../data/schema';
import { byggversion } from '../../platform/byggversion';
import {
  estimateStorage,
  requestPersistentStorage,
  type PersistenceState,
} from '../../platform/storage';

interface Status {
  schemaVersion: number;
  deviceId: string;
  persistence: PersistenceState;
  quotaBytes: number;
}

const PERSISTENCE_LABEL: Record<PersistenceState, string> = {
  persisted: 'Skyddad mot automatisk rensning',
  denied: 'Inte skyddad — webbläsaren kan rensa data',
  unsupported: 'Kan inte kontrolleras i den här webbläsaren',
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return 'okänt';
  }
  const megabytes = bytes / 1024 / 1024;
  return megabytes >= 1024
    ? `${(megabytes / 1024).toFixed(1)} GB`
    : `${Math.round(megabytes)} MB`;
}

export function StartPage({ db }: { db: KonteraDatabase }) {
  const [status, setStatus] = useState<Status | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      await db.open();
      const [deviceId, persistence, estimate] = await Promise.all([
        getOrCreateDeviceId(db),
        requestPersistentStorage(),
        estimateStorage(),
      ]);

      if (!cancelled) {
        setStatus({
          schemaVersion: db.verno,
          deviceId,
          persistence,
          quotaBytes: estimate?.quotaBytes ?? 0,
        });
      }
    }

    // Hard rule 11: a failure here is shown, not swallowed into the console.
    load().catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [db]);

  return (
    <section aria-label="Status">
      <h2>Status</h2>
      {error !== undefined && (
        <p role="alert" data-testid="status-error">
          Databasen kunde inte öppnas: {error}
        </p>
      )}
      {error === undefined && status === undefined && <p>Läser status …</p>}
      {status !== undefined && (
        <dl data-testid="status">
          <dt>Appens version</dt>
          <dd data-testid="app-version">
            {byggversion.commit}, byggd {byggversion.byggd}
          </dd>

          <dt>Databasversion</dt>
          <dd data-testid="schema-version">
            {status.schemaVersion} av {latestSchemaVersion()}
          </dd>

          <dt>Enhet</dt>
          <dd data-testid="device-id">{status.deviceId}</dd>

          <dt>Lagring</dt>
          <dd data-testid="persistence">{PERSISTENCE_LABEL[status.persistence]}</dd>

          <dt>Tillgängligt utrymme</dt>
          <dd>{formatBytes(status.quotaBytes)}</dd>
        </dl>
      )}
    </section>
  );
}
