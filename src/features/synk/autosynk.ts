import { useEffect, useRef } from 'react';

/**
 * Syncing without being asked to.
 *
 * Pressing a button after every booking is the kind of chore that gets
 * skipped, and a sync that is skipped is two devices quietly drifting apart -
 * which is the one failure this design cannot recover from gracefully, since
 * both sides then keep booking in the belief that they have seen everything.
 *
 * Four moments, and no timer. A timer would wake a phone in a pocket to ask
 * a server a question nobody is waiting for; these are the moments when the
 * answer is actually wanted:
 *
 * - the app opens, because the other device may have booked while this one
 *   was closed,
 * - it comes back into view, for the same reason,
 * - the network returns, because what was queued while offline can now go,
 * - something was booked here, after a pause long enough that a burst of
 *   entries becomes one round rather than five.
 *
 * Nothing happens until sync is set up: a server, a login and a passphrase
 * are three deliberate acts, and until all three are done the app makes no
 * network traffic at all (hard rule 7).
 */

export type Anledning = 'start' | 'synlig' | 'natet-tillbaka' | 'ny-handelse';

export interface Synklage {
  /** Logged in to a server and holding a passphrase. */
  readonly aktiv: boolean;
  readonly online: boolean;
  /** A round is already running; two at once would send everything twice. */
  readonly pagar: boolean;
  /** Entries waiting to be sent from this device. */
  readonly osankta: number;
  readonly anledning: Anledning;
}

/**
 * Whether a round should start.
 *
 * Pulled out of the hook because it is the part worth being sure about: the
 * hook is plumbing, this is the rule.
 *
 * A change made here is only worth sending when there is something to send.
 * The other three reasons are worth a round whatever the queue looks like -
 * they are all cases where the interesting news is what the *other* device
 * did, and an empty queue says nothing about that.
 */
export function skaSynkas(lage: Synklage): boolean {
  if (!lage.aktiv || !lage.online || lage.pagar) {
    return false;
  }
  return lage.anledning === 'ny-handelse' ? lage.osankta > 0 : true;
}

/** How long a burst of bookings is allowed to gather before it is sent. */
const DROJSMAL_MS = 4000;

interface Props {
  readonly aktiv: boolean;
  readonly osankta: number;
  readonly synka: () => Promise<unknown>;
  /**
   * Told when a round failed.
   *
   * Reported rather than swallowed (hard rule 11), but quietly: a phone that
   * lost signal mid-round is not an error the person holding it needs to
   * dismiss, and the next of the four moments tries again.
   */
  readonly onFel: (meddelande: string | undefined) => void;
}

export function useAutosynk({ aktiv, osankta, synka, onFel }: Props): void {
  /*
   * Refs rather than state: these must not make the effect run again, or
   * every finished round would schedule the next one.
   */
  const pagar = useRef(false);
  const senaste = useRef({ synka, onFel });
  senaste.current = { synka, onFel };

  useEffect(() => {
    if (!aktiv) {
      return;
    }

    let avbruten = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function kor(anledning: Anledning): Promise<void> {
      const online = globalThis.navigator?.onLine ?? true;
      if (!skaSynkas({ aktiv, online, pagar: pagar.current, osankta, anledning })) {
        return;
      }

      pagar.current = true;
      try {
        await senaste.current.synka();
        if (!avbruten) {
          senaste.current.onFel(undefined);
        }
      } catch (orsak) {
        if (!avbruten) {
          senaste.current.onFel(orsak instanceof Error ? orsak.message : String(orsak));
        }
      } finally {
        pagar.current = false;
      }
    }

    const nar = () => {
      if (globalThis.document?.visibilityState === 'visible') {
        void kor('synlig');
      }
    };
    const online = () => void kor('natet-tillbaka');

    globalThis.addEventListener?.('online', online);
    globalThis.document?.addEventListener('visibilitychange', nar);

    if (osankta > 0) {
      timer = setTimeout(() => void kor('ny-handelse'), DROJSMAL_MS);
    } else {
      void kor('start');
    }

    return () => {
      avbruten = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      globalThis.removeEventListener?.('online', online);
      globalThis.document?.removeEventListener('visibilitychange', nar);
    };
  }, [aktiv, osankta]);
}
