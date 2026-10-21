/**
 * Asking the server for a new version while the app stays open.
 *
 * The browser checks for a new service worker when the page loads, and
 * otherwise only on navigations, which a single-page app does not make. An
 * app on the iOS home screen is seldom loaded again: it is resumed from the
 * background, and can go days that way without looking. So the check is
 * made each time the app comes back to the foreground, and once an hour
 * while it stays there.
 *
 * Finding a new version installs it in the background and nothing more: the
 * banner asks before anything reloads, so an unsaved verifikat is never lost.
 */

/** Once an hour, for an app left open on a desk. */
export const KONTROLLINTERVALL_MS = 60 * 60 * 1000;

/** The part of a ServiceWorkerRegistration this needs. */
export interface Uppdaterbar {
  update(): Promise<unknown>;
}

/** The part of the document and window this needs, so tests can stand in. */
export interface Sidan {
  readonly synlig: () => boolean;
  readonly online: () => boolean;
  readonly narSynlighetAndras: (lyssnare: () => void) => () => void;
}

export function webbsidan(): Sidan {
  return {
    synlig: () => document.visibilityState === 'visible',
    online: () => navigator.onLine,
    narSynlighetAndras: (lyssnare) => {
      document.addEventListener('visibilitychange', lyssnare);
      return () => document.removeEventListener('visibilitychange', lyssnare);
    },
  };
}

/**
 * Starts checking for a new version. Returns a function that stops it.
 *
 * A failed check is left for the next one. It fails when the phone is
 * offline or the server is down for a moment, neither of which the user can
 * act on, and the app they already have keeps working.
 */
export function bevakaUppdateringar(
  registrering: Uppdaterbar,
  sidan: Sidan = webbsidan(),
  intervall: number = KONTROLLINTERVALL_MS,
): () => void {
  const kontrollera = () => {
    if (!sidan.synlig() || !sidan.online()) {
      return;
    }
    registrering.update().catch(() => undefined);
  };

  const sluta = sidan.narSynlighetAndras(kontrollera);
  const timer = setInterval(kontrollera, intervall);

  return () => {
    sluta();
    clearInterval(timer);
  };
}
