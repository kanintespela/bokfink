import { useEffect, useState } from 'react';

import { harFunktion, type Bokprofil } from '../domain/bok/bokprofil';

/**
 * The views along the bottom bar.
 *
 * The same five the bookkeeping apps people know settle on: an overview,
 * what is waiting to be booked, booking, what has been booked, and "Mer"
 * for everything done quarterly, yearly or once. Moms was a tab before, for
 * something done four times a year, while receipts - photographed every
 * week - were a link at the bottom of the start view.
 */
export const FLIKAR = ['attgora', 'kvitton', 'bokfor', 'verifikat', 'mer'] as const;

/** Everything reachable, including what is not a tab. */
export const VYER = [
  ...FLIKAR,
  'moms',
  'frikontering',
  'bank',
  'rapporter',
  /*
   * Each of these is one short screen under Mer. The settings were one page
   * once, and the kontoplan's three hundred rows meant everything else began
   * five screens down.
   */
  'bocker',
  'konton',
  'filer',
  'sakerhetskopia',
  'rakenskapsar',
  'enhet',
  'foretag',
  'anlaggning',
  'lager',
  'periodisering',
  'egetkapital',
  'arsbokslut',
  'nebilaga',
] as const;
export type Vy = (typeof VYER)[number];

export const VYNAMN: Record<Vy, string> = {
  attgora: 'Översikt',
  kvitton: 'Kvitton',
  mer: 'Mer',
  frikontering: 'Fri kontering',
  bank: 'Stäm av kontoutdrag',
  bokfor: 'Bokför',
  moms: 'Moms',
  rapporter: 'Rapporter',
  verifikat: 'Verifikat',
  bocker: 'Böcker',
  konton: 'Kontoplan',
  filer: 'Filer, import och export',
  sakerhetskopia: 'Säkerhetskopia',
  rakenskapsar: 'Räkenskapsår',
  enhet: 'Synk och den här enheten',
  foretag: 'Företaget',
  anlaggning: 'Anläggningar',
  lager: 'Djurlager',
  periodisering: 'Obetalda fakturor och periodisering',
  egetkapital: 'Eget kapital',
  arsbokslut: 'Förenklat årsbokslut',
  nebilaga: 'NE-bilaga',
};

/**
 * The views a book has no use for, and so does not show.
 *
 * Hidden rather than refused: the address of a hidden view opens the overview,
 * the same as an address that never existed, so a bookmark from the other kind
 * of book does not land on a screen that does not apply.
 */
export function doldaVyer(profil: Bokprofil, momsregistrerad: boolean): ReadonlySet<Vy> {
  const dolda = new Set<Vy>();
  if (!momsregistrerad) {
    dolda.add('moms');
  }
  if (!harFunktion(profil, 'nebilaga')) {
    dolda.add('nebilaga');
  }
  if (!harFunktion(profil, 'egnaUttag') && !harFunktion(profil, 'foreningskapital')) {
    dolda.add('egetkapital');
  }
  if (!harFunktion(profil, 'djurlager')) {
    dolda.add('lager');
  }
  if (!harFunktion(profil, 'k1Bokslut') && !harFunktion(profil, 'foreningsbokslut')) {
    dolda.add('arsbokslut');
  }
  return dolda;
}

/**
 * Which view is showing, kept in the address so the phone's back gesture
 * works.
 *
 * Written against the History API rather than a router. There are a handful
 * of views and no URLs anyone shares, so a dependency would buy nothing the
 * dependency policy would accept - but back has to go back, because on a
 * phone it is the button people reach for and leaving the app instead is a
 * small betrayal.
 */
export function useVy(): [Vy, (vy: Vy) => void] {
  const [vy, setVyTillstand] = useState<Vy>(() => franHash(globalThis.location?.hash));

  useEffect(() => {
    const lyssnare = () => setVyTillstand(franHash(globalThis.location.hash));
    globalThis.addEventListener('popstate', lyssnare);
    globalThis.addEventListener('hashchange', lyssnare);
    return () => {
      globalThis.removeEventListener('popstate', lyssnare);
      globalThis.removeEventListener('hashchange', lyssnare);
    };
  }, []);

  return [
    vy,
    (nasta: Vy) => {
      if (nasta !== vy) {
        globalThis.history.pushState({ vy: nasta }, '', `#${nasta}`);
        setVyTillstand(nasta);
      }
    },
  ];
}

/**
 * Addresses that moved, so a bookmark or a home-screen shortcut still lands
 * where it meant to.
 */
const FLYTTADE: Readonly<Record<string, Vy>> = {
  installningar: 'mer',
  // The drafts are part of the Kvitton tab, above the receipts.
  utkast: 'kvitton',
};

function franHash(hash: string | undefined): Vy {
  const namn = (hash ?? '').replace(/^#/, '');
  const flyttad = FLYTTADE[namn];
  if (flyttad !== undefined) {
    return flyttad;
  }
  return (VYER as readonly string[]).includes(namn) ? (namn as Vy) : 'attgora';
}
