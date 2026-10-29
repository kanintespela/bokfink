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
 * And one more, which is a timer but only of a kind that cannot wake
 * anything: after a round that failed, while the app is on screen. The
 * server is a computer at home, and computers restart; a phone that tried
 * while it was booting should not wait for the next time it is put away and
 * taken out to try again. The waits grow, so a server that is gone for the
 * evening costs one question every few minutes, and a hidden app asks
 * nothing at all - it tries again when it is next shown.
 *
 * Nothing happens until sync is set up: a server, a login and a passphrase
 * are three deliberate acts, and until all three are done the app makes no
 * network traffic at all (hard rule 7).
 */

export type Anledning =
  'start' | 'synlig' | 'natet-tillbaka' | 'ny-handelse' | 'nytt-forsok' | 'bevakning';

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

/**
 * How long to wait before trying again after the n:th failure in a row.
 *
 * Quick at first, since the common cause is a server that is starting and
 * will answer in a minute; then every five minutes, for as long as it takes.
 */
const FORSOK_MS = [15_000, 60_000, 300_000] as const;

export function vantetidEfterFel(misslyckade: number): number {
  return FORSOK_MS[Math.min(Math.max(misslyckade, 1), FORSOK_MS.length) - 1]!;
}

interface Props {
  readonly aktiv: boolean;
  readonly osankta: number;
  readonly synka: () => Promise<unknown>;
  /**
   * Something is expected from the other side within minutes - a receipt the
   * assistant is reading - and the person is looking at where it will show.
   * Then the app asks every so often instead of waiting for one of the four
   * moments, and only while it is on screen; nothing is asked from a pocket.
   */
  readonly bevaka?: boolean;
  /**
   * Told when a round failed.
   *
   * Reported rather than swallowed (hard rule 11), but quietly: a phone that
   * lost signal mid-round is not an error the person holding it needs to
   * dismiss, and the next of the four moments tries again.
   */
  readonly onFel: (meddelande: string | undefined) => void;
}

/** How often to ask while something is expected, see Props.bevaka. */
const BEVAKNING_MS = 20_000;

export function useAutosynk({
  aktiv,
  osankta,
  synka,
  onFel,
  bevaka = false,
}: Props): void {
  /*
   * Refs rather than state: these must not make the effect run again, or
   * every finished round would schedule the next one.
   */
  const pagar = useRef(false);
  /** Failed rounds in a row, which sets how long the next wait is. */
  const misslyckade = useRef(0);
  const senaste = useRef({ synka, onFel });
  senaste.current = { synka, onFel };

  useEffect(() => {
    if (!aktiv) {
      return;
    }

    let avbruten = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let forsok: ReturnType<typeof setTimeout> | undefined;

    async function kor(anledning: Anledning): Promise<void> {
      const online = globalThis.navigator?.onLine ?? true;
      if (!skaSynkas({ aktiv, online, pagar: pagar.current, osankta, anledning })) {
        return;
      }

      if (
        anledning === 'nytt-forsok' &&
        globalThis.document?.visibilityState === 'hidden'
      ) {
        // Shown again later, it is asked through 'synlig' instead.
        return;
      }

      pagar.current = true;
      if (forsok !== undefined) {
        clearTimeout(forsok);
        forsok = undefined;
      }
      try {
        await senaste.current.synka();
        misslyckade.current = 0;
        if (!avbruten) {
          senaste.current.onFel(undefined);
        }
      } catch (orsak) {
        misslyckade.current += 1;
        if (!avbruten) {
          senaste.current.onFel(orsak instanceof Error ? orsak.message : String(orsak));
          forsok = setTimeout(
            () => void kor('nytt-forsok'),
            vantetidEfterFel(misslyckade.current),
          );
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
      if (forsok !== undefined) {
        clearTimeout(forsok);
      }
      globalThis.removeEventListener?.('online', online);
      globalThis.document?.removeEventListener('visibilitychange', nar);
    };
  }, [aktiv, osankta]);

  /*
   * The watch: a round every so often while something is expected and the
   * app is on screen. Same lock as every other round, so two never overlap,
   * and failures reported the same way.
   */
  useEffect(() => {
    if (!aktiv || !bevaka) {
      return;
    }
    const tick = setInterval(() => {
      const online = globalThis.navigator?.onLine ?? true;
      if (
        globalThis.document?.visibilityState === 'hidden' ||
        !skaSynkas({
          aktiv,
          online,
          pagar: pagar.current,
          osankta: 0,
          anledning: 'bevakning',
        })
      ) {
        return;
      }
      pagar.current = true;
      senaste.current
        .synka()
        .then(() => senaste.current.onFel(undefined))
        .catch((orsak: unknown) =>
          senaste.current.onFel(orsak instanceof Error ? orsak.message : String(orsak)),
        )
        .finally(() => {
          pagar.current = false;
        });
    }, BEVAKNING_MS);
    return () => clearInterval(tick);
  }, [aktiv, bevaka]);
}
