import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import type { Uuid } from '../id/uuidv7';
import { kontonummer } from '../konto/konto';
import {
  andraProjekt,
  kodenFinns,
  medProjektPaKonto,
  LANGSTA_PROJEKTKOD,
  LANGSTA_PROJEKTNAMN,
  OgiltigtProjektError,
  projektkod,
  projektkodFranSie,
  projektnamn,
  projektnamnFranSie,
  skapaProjekt,
} from './projekt';

const id = '019b76da-a800-7000-8000-000000000001' as Uuid;

describe('projektkod', () => {
  it('takes letters, digits and . - _, trimmed', () => {
    expect(projektkod('  LEADER-28 ')).toBe('LEADER-28');
    expect(projektkod('P2026')).toBe('P2026');
    expect(projektkod('Ungdomsläger.1_a')).toBe('Ungdomsläger.1_a');
  });

  it('refuses nothing, too long, and anything a file would trip over', () => {
    expect(() => projektkod('   ')).toThrow(OgiltigtProjektError);
    expect(projektkod('x'.repeat(LANGSTA_PROJEKTKOD))).toHaveLength(LANGSTA_PROJEKTKOD);
    expect(() => projektkod('x'.repeat(LANGSTA_PROJEKTKOD + 1))).toThrow('högst 20');
    for (const ogiltig of ['två ord', 'a"b', 'a{b}', 'a;b', 'a/b']) {
      expect(() => projektkod(ogiltig), ogiltig).toThrow('bara innehålla');
    }
  });
});

describe('projektnamn', () => {
  it('folds inner spaces and refuses nothing, too long, and a quote', () => {
    expect(projektnamn('  Ungdomsläger   2026 ')).toBe('Ungdomsläger 2026');
    expect(() => projektnamn('')).toThrow('ett namn');
    expect(projektnamn('x'.repeat(LANGSTA_PROJEKTNAMN))).toHaveLength(
      LANGSTA_PROJEKTNAMN,
    );
    expect(() => projektnamn('x'.repeat(LANGSTA_PROJEKTNAMN + 1))).toThrow('högst 60');
    expect(() => projektnamn('Det "stora" lägret')).toThrow('citattecken');
  });
});

describe('skapaProjekt och andraProjekt', () => {
  it('starts open, with the code and name cleaned up', () => {
    expect(skapaProjekt({ id, kod: ' P2026 ', namn: 'Läger  2026' })).toEqual({
      id,
      kod: 'P2026',
      namn: 'Läger 2026',
      avslutat: false,
    });
  });

  it('changes the name and whether it is over, never the code', () => {
    const projekt = skapaProjekt({ id, kod: 'P2026', namn: 'Läger' });
    const andrat = andraProjekt(projekt, { namn: 'Sommarläger', avslutat: true });
    expect(andrat).toEqual({ id, kod: 'P2026', namn: 'Sommarläger', avslutat: true });
    expect(andraProjekt(andrat, { avslutat: false }).avslutat).toBe(false);
    expect(andraProjekt(andrat, {}).namn).toBe('Sommarläger');
  });

  it('refuses a name change to nothing', () => {
    const projekt = skapaProjekt({ id, kod: 'P2026', namn: 'Läger' });
    expect(() => andraProjekt(projekt, { namn: ' ' })).toThrow(OgiltigtProjektError);
  });
});

describe('kodenFinns', () => {
  it('finds a code whatever its case', () => {
    const projekt = [skapaProjekt({ id, kod: 'Leader-28', namn: 'Leader' })];
    expect(kodenFinns('LEADER-28 ', projekt)).toBe(true);
    expect(kodenFinns('leader-29', projekt)).toBe(false);
  });
});

describe('projektkodFranSie', () => {
  it('keeps a code that already fits', () => {
    expect(projektkodFranSie('P2026')).toBe('P2026');
    expect(projektkodFranSie('LEADER-28')).toBe('LEADER-28');
  });

  it('writes what does not fit as a dash, once, and not at the ends', () => {
    expect(projektkodFranSie('Läger 1/2026')).toBe('Läger-1-2026');
    expect(projektkodFranSie('  a  b  ')).toBe('a-b');
    expect(projektkodFranSie('/x/')).toBe('x');
    expect(projektkodFranSie('a"b{c}')).toBe('a-b-c');
  });

  it('cuts to length without leaving a dash at the end', () => {
    const kod = projektkodFranSie('abcdefghi jklmnopqrs tuvwxyz');
    expect(kod).toBe('abcdefghi-jklmnopqrs');
    expect(kod?.length).toBeLessThanOrEqual(LANGSTA_PROJEKTKOD);
    expect(projektkodFranSie('abcdefghijklmnopqrs/xyz')).toBe('abcdefghijklmnopqrs');
  });

  it('is undefined when nothing of the number can be used', () => {
    expect(projektkodFranSie('')).toBeUndefined();
    expect(projektkodFranSie('  /// ')).toBeUndefined();
  });

  it('always gives a code projektkod accepts', () => {
    for (const nummer of ['Läger 1/2026', 'a"b', '  x  ', 'Ä-Ö.1_2', 'a'.repeat(50)]) {
      const kod = projektkodFranSie(nummer);
      expect(kod, nummer).toBeDefined();
      expect(() => projektkod(kod!), nummer).not.toThrow();
    }
  });
});

describe('projektnamnFranSie', () => {
  it('turns a quote into an apostrophe, folds spaces and cuts to length', () => {
    expect(projektnamnFranSie('Det "stora"  lägret', 'P1')).toBe("Det 'stora' lägret");
    expect(projektnamnFranSie('x'.repeat(100), 'P1')).toHaveLength(LANGSTA_PROJEKTNAMN);
    expect(() =>
      projektnamn(projektnamnFranSie('Det "stora" lägret', 'P1')),
    ).not.toThrow();
  });

  it('falls back on the code when the file gives no name', () => {
    expect(projektnamnFranSie('', 'P1')).toBe('P1');
    expect(projektnamnFranSie('   ', 'P1')).toBe('P1');
  });
});

describe('medProjektPaKonto', () => {
  const rader = [
    { konto: kontonummer('5020'), belopp: oreFromKronor('800') },
    { konto: kontonummer('2641'), belopp: oreFromKronor('200') },
    { konto: kontonummer('1930'), belopp: oreFromKronor('-1000') },
  ];

  it('sets the project on the rows of that account only', () => {
    const resultat = medProjektPaKonto(rader, kontonummer('5020'), id);
    expect(resultat.map((rad) => rad.projekt)).toEqual([id, undefined, undefined]);
    expect(resultat[1]).toBe(rader[1]);
  });

  it('leaves the rows as they were when there is no project', () => {
    expect(medProjektPaKonto(rader, kontonummer('5020'), undefined)).toEqual(rader);
  });
});
