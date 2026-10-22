import { formatKronor } from '../domain/belopp/ore';
import type { Uuid } from '../domain/id/uuidv7';
import type { Konto, Kontonummer } from '../domain/konto/konto';
import { allaLov, stigTill, type Lov } from '../domain/beslutstrad/beslutstrad';
import { forvaltMomskonto } from '../domain/moms/momskonto';
import type { Rakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import {
  beteckning,
  type BokfortVerifikat,
  type Verifikat,
  type Verifikatutkast,
} from '../domain/verifikat/verifikat';

export interface Bocker {
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly rakenskapsar: ReadonlyMap<Uuid, Rakenskapsar>;
  readonly verifikat: ReadonlyMap<Uuid, BokfortVerifikat>;
  readonly utkast: ReadonlyMap<Uuid, Verifikatutkast>;
}

/** How many of the latest verifikat the overview shows. */
const SENASTE = 40;

/** How many hits a search returns. */
const TRAFFAR = 20;

/**
 * The books as plain text, for the assistant to suggest a booking from.
 *
 * Text rather than JSON because it is read, not parsed: a line per account
 * and per verifikat is what a person would want to glance over too, and it
 * costs a third of the characters. The latest verifikat are there because
 * how the same supplier was booked last time is the best suggestion there is.
 */
export function beskrivLage(bocker: Bocker): string {
  const ar = [...bocker.rakenskapsar.values()].sort((a, b) =>
    a.start.localeCompare(b.start),
  );
  const konton = [...bocker.konton.values()]
    .filter((konto) => konto.aktiv)
    .sort((a, b) => a.nummer.localeCompare(b.nummer));
  const utkast = [...bocker.utkast.values()].sort((a, b) =>
    a.datum.localeCompare(b.datum),
  );

  return [
    'Räkenskapsår',
    ...ar.map((post) => `  ${post.start}–${post.slut} ${arstatus(post)}`),
    '',
    'Svar i appens frågor om vad som hänt (BAS K1)',
    ...allaLov().map((lov) => `  ${lovrad(lov)}`),
    '',
    'Utkast som väntar',
    ...(utkast.length === 0 ? ['  inga'] : utkast.map((post) => `  ${rad(post)}`)),
    '',
    `Senaste ${SENASTE} verifikat`,
    ...nyastForst(bocker.verifikat)
      .slice(0, SENASTE)
      .map((post) => `  ${rad(post)}`),
    '',
    'Aktiva konton',
    ...konton.map((konto) => `  ${konto.nummer} ${konto.namn}`),
    '',
  ].join('\n');
}

/**
 * Booked verifikat whose description or row notes contain the words.
 *
 * Case and accents are folded, so "lantmannen" finds "Lantmännen" - a
 * supplier's name read off a thermal receipt rarely keeps its dots.
 */
export function sok(bocker: Bocker, fraga: string): string {
  const ord = folda(fraga)
    .split(/\s+/)
    .filter((del) => del.length > 0);
  if (ord.length === 0) {
    throw new TypeError('Ange vad som ska sökas efter.');
  }

  const traffar = nyastForst(bocker.verifikat).filter((post) => {
    const text = folda(
      [
        post.beskrivning,
        ...post.konteringar.map((kontering) => kontering.text ?? ''),
      ].join(' '),
    );
    return ord.every((del) => text.includes(del));
  });

  if (traffar.length === 0) {
    return `Inga verifikat matchar "${fraga}".\n`;
  }
  return `${traffar
    .slice(0, TRAFFAR)
    .map((post) => rad(post))
    .join('\n')}\n`;
}

function nyastForst(
  verifikat: ReadonlyMap<Uuid, BokfortVerifikat>,
): readonly BokfortVerifikat[] {
  return [...verifikat.values()].sort(
    (a, b) =>
      b.datum.localeCompare(a.datum) ||
      b.serie.localeCompare(a.serie) ||
      b.nummer - a.nummer,
  );
}

function rad(post: Verifikat): string {
  const huvud =
    post.status === 'bokfort'
      ? `${beteckning(post)} ${post.datum}`
      : `${post.datum} (id ${post.id})`;
  const konteringar = post.konteringar
    .map((kontering) => `${kontering.konto} ${formatKronor(kontering.belopp)}`)
    .join(' / ');
  return `${huvud} ${post.beskrivning}: ${konteringar}`;
}

/**
 * One leaf of the booking questions, the way the form would book it - so a
 * suggestion made here lands on the same accounts as one made in the app.
 */
function lovrad(lov: Lov): string {
  const stig = [...(stigTill(lov.id) ?? []), lov.namn].join(' › ');
  const momskonto = forvaltMomskonto(lov.riktning, 25);
  const moms =
    lov.moms.typ === 'fast'
      ? lov.moms.sats === 0
        ? 'ingen moms'
        : `moms ${lov.moms.sats} % på ${forvaltMomskonto(lov.riktning, lov.moms.sats)}`
      : lov.moms.typ === 'livsmedel'
        ? 'moms för livsmedel: 12 % före 2026-04-01, 6 % till och med 2027-12-31'
        : `moms enligt underlaget, oftast ${lov.moms.forval} %${momskonto === undefined ? '' : ` (25 % på ${momskonto})`}`;
  return `${stig} (${lov.riktning}): ${lov.konto}, ${moms}; betalas via ${lov.betalsatt.join('/')}`;
}

function arstatus(ar: Rakenskapsar): string {
  if (ar.avslutat) {
    return 'avslutat';
  }
  return ar.momslastTom === undefined
    ? 'öppet'
    : `öppet, momslåst t.o.m. ${ar.momslastTom}`;
}

function folda(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
