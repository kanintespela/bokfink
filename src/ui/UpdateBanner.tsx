import { useRegisterSW } from 'virtual:pwa-register/react';

import { bevakaUppdateringar } from '../platform/uppdatering';

/**
 * Offers a new version instead of installing it behind the user's back.
 * Reloading mid-entry would discard an unsaved verifikat.
 *
 * The check runs for as long as the app does, so nothing stops it.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registrering) {
      if (registrering !== undefined) {
        bevakaUppdateringar(registrering);
      }
    },
  });

  if (!needRefresh) {
    return null;
  }

  return (
    <div role="status" className="update-banner">
      <span>En ny version av Bokfink är redo.</span>
      <button
        type="button"
        className="knapp"
        onClick={() => void updateServiceWorker(true)}
      >
        Uppdatera
      </button>
    </div>
  );
}
