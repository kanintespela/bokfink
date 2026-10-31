import type { Inflate } from '../domain/arkiv/zipLasare';
import { ZipFel } from '../domain/arkiv/zipLasare';

/**
 * Inflates a raw deflate stream with the browser's own decompression.
 *
 * Nothing is added to the bundle for it. A stream that gives more than the
 * archive said it would is stopped when it passes the figure, before it has
 * been collected, so an archive that lies about its size cannot fill the
 * memory of the phone.
 */
export const inflateRaw: Inflate = async (data, hogst) => {
  if (typeof DecompressionStream === 'undefined') {
    throw new ZipFel(
      'den här webbläsaren kan inte packa upp zip-filer. Packa upp filen först och välj SIE-filen i den.',
    );
  }
  const strom = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const lasare = strom.getReader();
  const stycken: Uint8Array[] = [];
  let totalt = 0;
  for (;;) {
    const { done, value } = await lasare.read();
    if (done) {
      break;
    }
    totalt += value.length;
    if (totalt > hogst) {
      await lasare.cancel();
      throw new ZipFel('en fil blev större uppackad än arkivet anger.');
    }
    stycken.push(value);
  }
  const ut = new Uint8Array(totalt);
  let pos = 0;
  for (const del of stycken) {
    ut.set(del, pos);
    pos += del.length;
  }
  return ut;
};
