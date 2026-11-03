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

export type Teckenuppsattning = 'PC8' | 'UTF-8';

/**
 * Reads the bytes of a SIE file as text, in whichever of the two sets it is in.
 *
 * The format allows PC8 only, and that is what the header of every file says,
 * but some programs write UTF-8 under that header all the same. Read as PC8,
 * the two bytes of an ä (C3 A4) come out as "├ñ", so a file that says one thing
 * and is the other has to be told by its bytes.
 *
 * UTF-8 is tried first and strictly: Swedish text in PC8 has bytes like 0x84
 * and 0x86 that stand alone, which UTF-8 rejects, so a PC8 file is not taken
 * for UTF-8 by accident. The reverse mistake needs PC8 text that happens to
 * form valid UTF-8 sequences, which takes box-drawing characters a SIE file
 * has no use for. A file with no byte above 127 reads the same either way and
 * is called PC8, which is what it says. A byte order mark is dropped, since it
 * would otherwise stand in front of the first #.
 */
export function avkodaSieText(bytes: Uint8Array): {
  readonly text: string;
  readonly teckenuppsattning: Teckenuppsattning;
} {
  const harBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const innehall = harBom ? bytes.subarray(3) : bytes;

  if (harBom || innehall.some((byte) => byte >= 128)) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(innehall);
      return { text, teckenuppsattning: 'UTF-8' };
    } catch {
      // Not UTF-8: the file is in PC8 after all.
    }
  }
  return { text: avkodaPC8(innehall), teckenuppsattning: 'PC8' };
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

/**
 * Why a text cannot go into a SIE file, in words, or undefined if it can.
 *
 * Asked while the text is typed. The export refuses such a character
 * ({@link kodaPC8}) years later, at the moment a year is to be archived, and
 * by then it sits in a booked verifikat.
 */
export function pc8Varning(text: string): string | undefined {
  const felaktiga = new Set<string>();
  for (const tecken of medPC8Motsvarigheter(text)) {
    if (tecken.codePointAt(0)! >= 128 && !BYTE_FOR_TECKEN.has(tecken)) {
      felaktiga.add(tecken);
    }
  }
  if (felaktiga.size === 0) {
    return undefined;
  }
  return (
    `Tecknet ${[...felaktiga].join(' ')} kan inte skrivas i en SIE-fil, så bokföringen ` +
    'går inte att exportera. Ta bort det.'
  );
}
