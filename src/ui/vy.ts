import { useEffect, useState } from 'react';

/** The views along the bottom bar. */
export const FLIKAR = ['attgora', 'bokfor', 'moms', 'verifikat'] as const;

/**
 * Everything reachable, including what is not a tab.
 *
 * Four tabs is what a phone holds along the bottom without the labels
 * shrinking past reading. Registers and settings are reached from Att göra
 * instead - they are visited rarely and never in a hurry.
 */
export const VYER = [
  ...FLIKAR,
  'kvitton',
  'utkast',
  'frikontering',
  'bank',
  'rapporter',
  /*
   * Inställningar is a menu, and each of these is one short screen under it.
   * They were one page once, and the kontoplan's three hundred rows meant
   * everything else began five screens down.
   */
  'installningar',
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
  attgora: 'Att göra',
  kvitton: 'Kvitton',
  utkast: 'Utkast',
  frikontering: 'Fri kontering',
  bank: 'Bankimport',
  bokfor: 'Bokför',
  moms: 'Moms',
  rapporter: 'Rapporter',
  verifikat: 'Verifikat',
  installningar: 'Inställningar',
  bocker: 'Böcker',
  konton: 'Kontoplan',
  filer: 'Filer, import och export',
  sakerhetskopia: 'Säkerhetskopia',
  rakenskapsar: 'Räkenskapsår',
  enhet: 'Den här enheten',
  foretag: 'Företaget',
  anlaggning: 'Anläggningar',
  lager: 'Djurlager',
  periodisering: 'Obetalda fakturor och periodisering',
  egetkapital: 'Eget kapital',
  arsbokslut: 'Årsbokslut',
  nebilaga: 'NE-bilaga',
};

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

function franHash(hash: string | undefined): Vy {
  const namn = (hash ?? '').replace(/^#/, '');
  return (VYER as readonly string[]).includes(namn) ? (namn as Vy) : 'attgora';
}
