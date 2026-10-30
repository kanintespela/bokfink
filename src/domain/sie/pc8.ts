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
  constructor(
    readonly tecken: string,
    /** Where it stands, when the caller knows, so it can be found and corrected. */
    readonly plats?: string,
  ) {
    super(
      `Tecknet "${tecken}" finns inte i teckenuppsättningen PC8 och kan därför ` +
        'inte skrivas till en SIE-fil.' +
        (plats === undefined ? '' : ` Det står här: ${plats}`),
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

/**
 * What a typographic character is written as where the set has no such thing.
 *
 * PC8 is the 1980s code page, and text typed in a phone or pasted from an
 * invoice is full of characters it lacks: the en dash in "Oct 5-Nov 5", curly
 * quotes, the euro sign, a non-breaking space. Refusing them stopped a whole
 * archive over a dash. These are the ones that have an obvious plain
 * equivalent, and only these: a character with none (an emoji, a letter from
 * another alphabet) is still refused by {@link kodaPC8}, since guessing at it
 * is the mangling that refusal exists to prevent. The books keep the original
 * text; only the file says it the plain way.
 */
const LIKA_TECKEN = new Map<string, string>([
  // Dashes and the minus sign.
  ...['\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015', '\u2212'].map(
    (tecken): [string, string] => [tecken, '-'],
  ),
  // Single and double quotation marks.
  ...['\u2018', '\u2019', '\u201A', '\u201B', '\u2032'].map(
    (tecken): [string, string] => [tecken, "'"],
  ),
  ...['\u201C', '\u201D', '\u201E', '\u201F', '\u2033'].map(
    (tecken): [string, string] => [tecken, '"'],
  ),
  ['\u2026', '...'],
  ['\u20AC', 'EUR'],
  ['\u2022', '\u00B7'],
  ['\u00D7', 'x'],
  // Spaces of every width, and the characters that take up none.
  ...[
    '\u00A0',
    '\u2002',
    '\u2003',
    '\u2004',
    '\u2005',
    '\u2006',
    '\u2007',
    '\u2008',
    '\u2009',
    '\u200A',
    '\u202F',
    '\u205F',
    '\u3000',
  ].map((tecken): [string, string] => [tecken, ' ']),
  ...['\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF'].map(
    (tecken): [string, string] => [tecken, ''],
  ),
]);

/** The text with every character that has a plain equivalent written that way. */
export function medPC8Motsvarigheter(text: string): string {
  let ut = '';
  for (const tecken of text) {
    ut += LIKA_TECKEN.get(tecken) ?? tecken;
  }
  return ut;
}
