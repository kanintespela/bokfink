/**
 * PC8, the character set a SIE file declares with `#FORMAT PC8`.
 *
 * PC8 is IBM code page 437. The browser cannot help here: TextDecoder has no
 * cp437 label, and the closest thing it does have, ibm866, is Cyrillic - it
 * would turn å, ä and ö into Russian letters without failing. So the table is
 * written out.
 *
 * Only the upper half is listed. Bytes 0 to 127 are ASCII and pass through.
 */
const HOGA_TECKEN = [
  'Ç',
  'ü',
  'é',
  'â',
  'ä',
  'à',
  'å',
  'ç',
  'ê',
  'ë',
  'è',
  'ï',
  'î',
  'ì',
  'Ä',
  'Å',
  'É',
  'æ',
  'Æ',
  'ô',
  'ö',
  'ò',
  'û',
  'ù',
  'ÿ',
  'Ö',
  'Ü',
  '¢',
  '£',
  '¥',
  '₧',
  'ƒ',
  'á',
  'í',
  'ó',
  'ú',
  'ñ',
  'Ñ',
  'ª',
  'º',
  '¿',
  '⌐',
  '¬',
  '½',
  '¼',
  '¡',
  '«',
  '»',
  '░',
  '▒',
  '▓',
  '│',
  '┤',
  '╡',
  '╢',
  '╖',
  '╕',
  '╣',
  '║',
  '╗',
  '╝',
  '╜',
  '╛',
  '┐',
  '└',
  '┴',
  '┬',
  '├',
  '─',
  '┼',
  '╞',
  '╟',
  '╚',
  '╔',
  '╩',
  '╦',
  '╠',
  '═',
  '╬',
  '╧',
  '╨',
  '╤',
  '╥',
  '╙',
  '╘',
  '╒',
  '╓',
  '╫',
  '╪',
  '┘',
  '┌',
  '█',
  '▄',
  '▌',
  '▐',
  '▀',
  'α',
  'ß',
  'Γ',
  'π',
  'Σ',
  'σ',
  'µ',
  'τ',
  'Φ',
  'Θ',
  'Ω',
  'δ',
  '∞',
  'φ',
  'ε',
  '∩',
  '≡',
  '±',
  '≥',
  '≤',
  '⌠',
  '⌡',
  '÷',
  '≈',
  '°',
  '∙',
  '·',
  '√',
  'ⁿ',
  '²',
  '■',
  ' ',
] as const;

/** Reverse table, built once, for writing files back out. */
const BYTE_FOR_TECKEN = new Map<string, number>(
  HOGA_TECKEN.map((tecken, index) => [tecken, index + 128]),
);

export function avkodaPC8(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    text += byte < 128 ? String.fromCharCode(byte) : (HOGA_TECKEN[byte - 128] ?? '�');
  }
  return text;
}

export class OkodbartTeckenError extends Error {
  constructor(tecken: string) {
    super(
      `Tecknet "${tecken}" finns inte i teckenuppsättningen PC8 och kan därför ` +
        'inte skrivas till en SIE-fil.',
    );
    this.name = 'OkodbartTeckenError';
  }
}

/**
 * Encodes back to PC8, refusing characters the set does not contain.
 *
 * Refusing rather than substituting: a silently mangled account name in an
 * exported file is the sort of thing nobody notices until an accountant asks
 * what "Frskning" means.
 */
export function kodaPC8(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const tecken = text.charAt(i);
    const kod = tecken.charCodeAt(0);

    if (kod < 128) {
      bytes[i] = kod;
      continue;
    }

    const byte = BYTE_FOR_TECKEN.get(tecken);
    if (byte === undefined) {
      throw new OkodbartTeckenError(tecken);
    }
    bytes[i] = byte;
  }
  return bytes;
}
