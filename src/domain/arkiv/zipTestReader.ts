/**
 * A minimal ZIP reader, used only by tests.
 *
 * Follows the central directory the way a real unzip tool does, rather than
 * assuming `skrivZip`'s own layout - that is what makes a test built on this
 * a test of the format, not just of the writer's internal bookkeeping.
 */
export interface Zipfilpost {
  readonly namn: string;
  readonly data: Uint8Array;
  readonly crc: number;
}

export function lasZip(zip: Uint8Array): Zipfilpost[] {
  const vy = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const dekodare = new TextDecoder();

  // The end-of-central-directory record is fixed size and has no comment
  // here, so it is always the last 22 bytes.
  const eocd = zip.length - 22;
  krav(
    vy.getUint32(eocd, true) === 0x06054b50,
    'saknar en giltig end-of-central-directory',
  );
  const antal = vy.getUint16(eocd + 10, true);
  let pos = vy.getUint32(eocd + 16, true);

  const poster: Zipfilpost[] = [];
  for (let i = 0; i < antal; i += 1) {
    krav(
      vy.getUint32(pos, true) === 0x02014b50,
      `post ${i} har fel central-directory-signatur`,
    );
    const crc = vy.getUint32(pos + 16, true);
    const storlek = vy.getUint32(pos + 24, true);
    const namnlangd = vy.getUint16(pos + 28, true);
    const extralangd = vy.getUint16(pos + 30, true);
    const kommentarlangd = vy.getUint16(pos + 32, true);
    const lokalOffset = vy.getUint32(pos + 42, true);
    const namn = dekodare.decode(zip.subarray(pos + 46, pos + 46 + namnlangd));

    // Follow the local header this entry points to, rather than trusting
    // that it sits right after the previous one.
    krav(
      vy.getUint32(lokalOffset, true) === 0x04034b50,
      `"${namn}" pekar på en ogiltig local file header`,
    );
    const lokalNamnlangd = vy.getUint16(lokalOffset + 26, true);
    const lokalExtralangd = vy.getUint16(lokalOffset + 28, true);
    const dataStart = lokalOffset + 30 + lokalNamnlangd + lokalExtralangd;
    const data = zip.slice(dataStart, dataStart + storlek);

    poster.push({ namn, data, crc });
    pos += 46 + namnlangd + extralangd + kommentarlangd;
  }
  return poster;
}

function krav(villkor: boolean, orsak: string): void {
  if (!villkor) {
    throw new Error(`Ogiltigt zip-arkiv: ${orsak}.`);
  }
}
