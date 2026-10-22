/**
 * ISO-8859-1, which Skatteverket's files - the eSKD momsdeklaration and the
 * SRU files - declare and expect.
 *
 * Refuses anything the encoding cannot hold rather than substituting, for the
 * same reason PC8 does: a mangled name in a filed return is not something
 * anyone notices in time.
 */
export function kodaLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const kod = text.charCodeAt(i);
    if (kod > 255) {
      throw new RangeError(
        `Tecknet "${text.charAt(i)}" ryms inte i ISO-8859-1 och kan inte skrivas ` +
          'till en fil för Skatteverket.',
      );
    }
    bytes[i] = kod;
  }
  return bytes;
}
