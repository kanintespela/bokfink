/**
 * Base64 for the bytes a JSON backup has to carry.
 *
 * JSON cannot hold binary, and the backup is deliberately one readable file,
 * so receipt images travel base64-encoded and a third larger than they are.
 * That is the price of a backup anyone can open without Kontera; the
 * incremental, content-addressed backup in stage 5 is what makes it stop
 * mattering.
 */

/** Large enough to be quick, small enough not to overflow the call stack. */
const CHUNK = 8192;

export function tillBase64(data: Uint8Array): string {
  let text = '';
  for (let i = 0; i < data.length; i += CHUNK) {
    text += String.fromCharCode(...data.subarray(i, i + CHUNK));
  }
  return btoa(text);
}

export function franBase64(text: string): Uint8Array {
  const binart = atob(text);
  const data = new Uint8Array(binart.length);
  for (let i = 0; i < binart.length; i += 1) {
    data[i] = binart.charCodeAt(i);
  }
  return data;
}
