/**
 * Getting files in and out of the app.
 *
 * Isolated here because this is where iOS is most unlike everything else, and
 * the plan puts platform quirks in one place rather than spread through the
 * screens. Everything runs locally: nothing is uploaded, and the share sheet
 * is the device's own.
 */

export interface Valdfil {
  readonly namn: string;
  readonly innehall: Uint8Array;
  /**
   * What the browser says the file is.
   *
   * Empty often enough to be worth saying so: a file reached through iOS
   * Files, or from a filesystem with no type database, arrives without one.
   * Callers that need the type fall back to the extension.
   */
  readonly typ: string;
}

export async function lasValdaFiler(filer: FileList | null): Promise<Valdfil[]> {
  if (filer === null) {
    return [];
  }
  return Promise.all(
    [...filer].map(async (fil) => ({
      namn: fil.name,
      innehall: new Uint8Array(await fil.arrayBuffer()),
      typ: fil.type,
    })),
  );
}

/**
 * Reads a text file whose encoding is not stated.
 *
 * A bank exports CSV in whatever its systems use: UTF-8 from the newer ones,
 * windows-1252 from the older, and neither says which. UTF-8 is tried first
 * and strictly - a windows-1252 file with an å in it is not valid UTF-8, so
 * the failure is the answer rather than a guess. The other way round would
 * decode silently and turn every å into two characters.
 */
export function avkodaText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * Hands a file to the user.
 *
 * Web Share first, because on an installed PWA on iOS that is what reaches
 * Mail, Meddelanden and Filer - a download link there lands in a place that
 * is awkward to find again. Everywhere else, and when sharing is declined,
 * an ordinary download link does the job.
 */
export async function delaEllerSpara(
  namn: string,
  innehall: Uint8Array | string,
  mimetyp: string,
): Promise<'delad' | 'nedladdad'> {
  const del = innehall instanceof Uint8Array ? [innehall as BlobPart] : [innehall];
  const blob = new Blob(del, { type: mimetyp });
  const fil = new File([blob], namn, { type: mimetyp });

  if (
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [fil] }) &&
    typeof navigator.share === 'function'
  ) {
    try {
      await navigator.share({ files: [fil], title: namn });
      return 'delad';
    } catch (orsak) {
      // A cancelled share is a choice, not a failure; fall through to saving.
      if (orsak instanceof DOMException && orsak.name === 'AbortError') {
        return 'nedladdad';
      }
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const lank = document.createElement('a');
    lank.href = url;
    lank.download = namn;
    lank.rel = 'noopener';
    document.body.append(lank);
    lank.click();
    lank.remove();
  } finally {
    // Revoked on the next tick so the click has taken the URL first.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return 'nedladdad';
}
