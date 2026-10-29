import type { Handelse } from '../handelse/handelse';

/**
 * When the receipt assistant last did something in these books, if ever.
 *
 * The assistant is the device that leaves drafts and never books: it has no
 * verifikatserie and cannot (hard rule 10). That is what tells it apart in
 * the log without the app having to be told which device it is - the
 * watcher's device name is a setting on the server, and the app should not
 * need to know it to say "the assistant is reading your receipt".
 *
 * Returns the time of its latest entry, so a watcher that has stopped is
 * not promised for ever.
 */
export function assistentenSenast(logg: Iterable<Handelse>): string | undefined {
  const bokforande = new Set<string>();
  const utkastskrivare = new Set<string>();
  const senast = new Map<string, string>();

  for (const handelse of logg) {
    if (handelse.typ === 'verifikat.bokfort') {
      bokforande.add(handelse.enhet);
    }
    if (handelse.typ === 'utkast.sparat') {
      utkastskrivare.add(handelse.enhet);
    }
    const forra = senast.get(handelse.enhet);
    if (forra === undefined || handelse.tidpunkt > forra) {
      senast.set(handelse.enhet, handelse.tidpunkt);
    }
  }

  let svar: string | undefined;
  for (const enhet of utkastskrivare) {
    const tid = senast.get(enhet);
    if (
      !bokforande.has(enhet) &&
      tid !== undefined &&
      (svar === undefined || tid > svar)
    ) {
      svar = tid;
    }
  }
  return svar;
}
