/**
 * The sync server's address, guessed from where the app itself was loaded.
 *
 * The setup in server/ puts both on one machine behind tailscale serve: the
 * app on :8443 and the server on :8444. Typing an address of that length on
 * a phone is where setting up goes wrong, so a device opened from such an
 * address is offered the matching one. It is only a value in a field - the
 * person still presses Logga in, and nothing is sent before that (hard rule
 * 7).
 */
export const SYNKPORT = '8444';

export function foreslagenServer(plats: {
  readonly protocol: string;
  readonly hostname: string;
}): string {
  if (plats.protocol !== 'https:' || !plats.hostname.endsWith('.ts.net')) {
    return '';
  }
  return `https://${plats.hostname}:${SYNKPORT}`;
}
