import { kronorString, type Ore } from '../belopp/ore';
import type { Datum } from '../tid/datum';
import { medPC8Motsvarigheter } from './pc8';
import type { Siedokument, Siekonto, Siesaldo, Sieverifikat } from './parser';

/**
 * Writes a SIE-4 file.
 *
 * Which fields are quoted is fixed by the format rather than by a rule about
 * their contents: #KONTO quotes the name but not the number, #VER quotes the
 * series and the description but not the number or the dates. Guessing from
 * the value would produce files that differ from every other program's for
 * no reason, so each record states its own shape.
 *
 * The result is text. Turning it into the bytes a SIE file actually contains
 * is kodaPC8's job, and it will refuse anything the character set cannot hold.
 * Text is first put through medPC8Motsvarigheter, so a dash or a curly quote
 * that has a plain equivalent is written as that rather than stopping the file.
 */
export function skrivSie(dokument: Siedokument): string {
  const rader: string[] = [
    '#FLAGGA 0',
    `#FORMAT ${dokument.format}`,
    `#SIETYP ${dokument.sietyp}`,
  ];

  if (dokument.orgnr !== undefined) {
    rader.push(`#ORGNR ${dokument.orgnr}`);
  }
  if (dokument.foretagsnamn !== undefined) {
    rader.push(`#FNAMN ${citera(dokument.foretagsnamn)}`);
  }
  if (dokument.valuta !== undefined) {
    rader.push(`#VALUTA ${dokument.valuta}`);
  }

  for (const ar of dokument.rakenskapsar) {
    rader.push(`#RAR ${ar.index} ${sieDatum(ar.start)} ${sieDatum(ar.slut)}`);
  }

  for (const konto of dokument.konton) {
    rader.push(`#KONTO ${konto.nummer} ${citera(konto.namn)}`);
  }
  for (const konto of dokument.konton) {
    if (konto.typ !== undefined) {
      rader.push(`#KTYP ${konto.nummer} ${konto.typ}`);
    }
  }
  for (const konto of dokument.konton) {
    for (const kod of konto.sru) {
      rader.push(`#SRU ${konto.nummer} ${kod}`);
    }
  }

  rader.push(...saldon('IB', dokument.ingaende));
  rader.push(...saldon('UB', dokument.utgaende));
  rader.push(...saldon('RES', dokument.resultat));

  for (const ver of dokument.verifikat) {
    rader.push(...verifikatrader(ver));
  }

  return `${rader.join('\n')}\n`;
}

function saldon(etikett: string, poster: readonly Siesaldo[]): string[] {
  return poster.map(
    (post) => `#${etikett} ${post.arsindex} ${post.konto} ${belopp(post.belopp)}`,
  );
}

function verifikatrader(ver: Sieverifikat): string[] {
  const huvud =
    `#VER ${citera(ver.serie)} ${ver.nummer} ${sieDatum(ver.datum)} ` +
    `${citera(ver.text)} ${ver.registrerad === undefined ? '' : sieDatum(ver.registrerad)}`;

  const rader = [huvud.trimEnd(), '{'];

  for (const trans of ver.transaktioner) {
    let rad = `#TRANS ${trans.konto} {} ${belopp(trans.belopp)}`;
    if (trans.datum !== undefined || trans.text !== undefined) {
      rad += ` ${trans.datum === undefined ? sieDatum(ver.datum) : sieDatum(trans.datum)}`;
      rad += ` ${citera(trans.text ?? '')}`;
    }
    rader.push(rad);
  }

  rader.push('}');
  return rader;
}

/**
 * Amounts are written with a dot and exactly two decimals, straight from the
 * öre they are stored as. No float is constructed on the way out any more
 * than on the way in.
 */
function belopp(varde: Ore): string {
  return kronorString(varde);
}

function sieDatum(varde: Datum): string {
  return varde.replaceAll('-', '');
}

function citera(text: string): string {
  const enkel = medPC8Motsvarigheter(text);
  return `"${enkel.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** Sorts accounts by number, which is the order every SIE file uses. */
export function iKontoordning(konton: readonly Siekonto[]): Siekonto[] {
  return [...konton].sort((a, b) => a.nummer.localeCompare(b.nummer));
}
