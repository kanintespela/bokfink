import { describe, expect, it } from 'vitest';

import { BRANSCHER, STANDARD_BRANSCH, tolkaBransch, type Bransch } from '../bok/bransch';
import { kontonummer } from '../konto/konto';
import { allaLov, BESLUTSTRAD, kontonITradet, type Fraga } from './beslutstrad';
import { anpassaTrad } from './bransch';
import { beslutstradFor } from './tradval';

const ANDRA = BRANSCHER.filter((bransch) => bransch !== 'gard');

function fraga(nod: Fraga, id: string): Fraga | undefined {
  if (nod.id === id) {
    return nod;
  }
  for (const svar of nod.svar) {
    if (svar.till.typ === 'fraga') {
      const hittad = fraga(svar.till, id);
      if (hittad !== undefined) {
        return hittad;
      }
    }
  }
  return undefined;
}

function svarsTexter(rot: Fraga, id: string): string[] {
  const hittad = fraga(rot, id);
  if (hittad === undefined) {
    throw new Error(`Ingen fråga ${id}`);
  }
  return hittad.svar.map((svar) => svar.text);
}

describe('anpassaTrad', () => {
  it('leaves the farm exactly as written', () => {
    expect(anpassaTrad(BESLUTSTRAD, 'gard')).toBe(BESLUTSTRAD);
    expect(beslutstradFor('enskild_firma')).toBe(BESLUTSTRAD);
  });

  it.each(ANDRA)('keeps every leaf, account and top answer for %s', (bransch) => {
    const trad = anpassaTrad(BESLUTSTRAD, bransch);
    expect(
      allaLov(trad)
        .map((lov) => lov.id)
        .sort(),
    ).toEqual(
      allaLov(BESLUTSTRAD)
        .map((lov) => lov.id)
        .sort(),
    );
    expect([...kontonITradet(trad)].sort()).toEqual(
      [...kontonITradet(BESLUTSTRAD)].sort(),
    );
    // Same answers under each question, in some order, with a label or two reworded.
    for (const id of ['pengar-ut', 'pengar-in']) {
      expect(svarsTexter(trad, id)).toHaveLength(svarsTexter(BESLUTSTRAD, id).length);
    }
  });

  it.each(ANDRA)('does not change what a leaf books on for %s', (bransch) => {
    const fran = new Map(allaLov(BESLUTSTRAD).map((lov) => [lov.id, lov]));
    for (const lov of allaLov(anpassaTrad(BESLUTSTRAD, bransch))) {
      const ursprung = fran.get(lov.id);
      expect(lov.konto, lov.id).toBe(ursprung?.konto);
      expect(lov.moms, lov.id).toEqual(ursprung?.moms);
      expect(lov.riktning, lov.id).toBe(ursprung?.riktning);
      // The same ways to pay, only the likeliest first.
      expect([...lov.betalsatt].sort(), lov.id).toEqual(
        [...(ursprung?.betalsatt ?? [])].sort(),
      );
    }
  });

  it.each(ANDRA)(
    'ends with "Något annat" and puts the animals last for %s',
    (bransch) => {
      const ut = svarsTexter(anpassaTrad(BESLUTSTRAD, bransch), 'pengar-ut');
      expect(ut.at(-1)).toBe('Något annat');
      expect(ut.indexOf('Djuren')).toBe(ut.length - 2);
      const inkomster = svarsTexter(anpassaTrad(BESLUTSTRAD, bransch), 'pengar-in');
      expect(inkomster.at(-1)).toBe('Sålt levande djur');
    },
  );

  it('starts each trade with what it books most', () => {
    const forst = (bransch: Bransch) =>
      svarsTexter(anpassaTrad(BESLUTSTRAD, bransch), 'pengar-ut')[0];
    expect(forst('tjanster')).toBe('Telefon, internet, program och kontor');
    expect(forst('hantverk')).toBe(
      'Varor och material som du säljer vidare eller bygger in',
    );
    expect(forst('handel')).toBe(
      'Varor och material som du säljer vidare eller bygger in',
    );
    expect(forst('annat')).toBe('Telefon, internet, program och kontor');
    expect(svarsTexter(anpassaTrad(BESLUTSTRAD, 'tjanster'), 'pengar-in')[0]).toBe(
      'Utfört arbete eller en tjänst',
    );
  });

  it('says nothing about a tractor to someone who has none', () => {
    const texter = svarsTexter(anpassaTrad(BESLUTSTRAD, 'tjanster'), 'maskiner').join(
      '|',
    );
    expect(texter).not.toMatch(/traktor|stängsel/);
    const inkomster = svarsTexter(anpassaTrad(BESLUTSTRAD, 'tjanster'), 'pengar-in');
    expect(inkomster).not.toContain('Sålt ull, skinn eller andra varor');
    expect(inkomster).toContain('Sålt varor');
  });

  it('offers paying from the firm account first, where the farm offers own money', () => {
    const material = (rot: Fraga) => allaLov(rot).find((lov) => lov.id === 'material');
    expect(material(BESLUTSTRAD)?.betalsatt[0]).toBe(kontonummer('2017'));
    expect(material(anpassaTrad(BESLUTSTRAD, 'annat'))?.betalsatt[0]).toBe(
      kontonummer('1930'),
    );
  });

  it('hands back the same tree for the same trade', () => {
    expect(anpassaTrad(BESLUTSTRAD, 'handel')).toBe(anpassaTrad(BESLUTSTRAD, 'handel'));
  });

  it('gives an association its own questions whatever the trade', () => {
    expect(beslutstradFor('forening', 'handel')).toBe(beslutstradFor('forening'));
  });
});

describe('tolkaBransch', () => {
  it('gives an older book the farm, and an unknown trade a neutral order', () => {
    expect(tolkaBransch(undefined)).toBe(STANDARD_BRANSCH);
    expect(tolkaBransch('hantverk')).toBe('hantverk');
    expect(tolkaBransch('en-ny-bransch')).toBe('annat');
  });
});
