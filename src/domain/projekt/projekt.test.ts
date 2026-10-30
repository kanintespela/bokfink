import { describe, expect, it } from 'vitest';

import type { Uuid } from '../id/uuidv7';
import {
  andraProjekt,
  kodenFinns,
  LANGSTA_PROJEKTKOD,
  LANGSTA_PROJEKTNAMN,
  OgiltigtProjektError,
  projektkod,
  projektnamn,
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
