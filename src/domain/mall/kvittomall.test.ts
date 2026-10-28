import { describe, expect, it } from 'vitest';

import type { Uuid } from '../id/uuidv7';
import { kontonummer } from '../konto/konto';
import type { Konteringsmall } from './konteringsmall';
import { foreslaMallForText } from './kvittomall';

let raknare = 0;

function mall(namn: string, sokord: readonly string[] = []): Konteringsmall {
  raknare += 1;
  return {
    id: `019b76da-a800-7000-8000-${String(raknare).padStart(12, '0')}` as Uuid,
    namn,
    sokord,
    riktning: 'utgift',
    konto: kontonummer('4010'),
    momssats: 25,
  };
}

const FODER = mall('Inköp av foder', ['kraftfoder', 'hö', 'ensilage']);
const DRIVMEDEL = mall('Drivmedel', ['diesel', 'bensin']);
const MALLAR = [FODER, DRIVMEDEL];

describe('foreslaMallForText', () => {
  it('finds the template a keyword on the receipt names', () => {
    const forslag = foreslaMallForText(MALLAR, 'Lantbruk AB\nKraftfoder 25 kg 416,25');
    expect(forslag?.mall).toBe(FODER);
    expect(forslag?.traff).toBe('kraftfoder');
  });

  it('matches the template name as well as its keywords', () => {
    expect(foreslaMallForText(MALLAR, 'OKQ8\nDrivmedel 95 oktan')?.mall).toBe(DRIVMEDEL);
  });

  it('ignores case and accents, which OCR gets wrong anyway', () => {
    expect(foreslaMallForText(MALLAR, 'INKOP AV FODER')?.mall).toBe(FODER);
  });

  /*
   * The failure that would make the feature untrustworthy: a suggestion that
   * fills in a form is believed, so a word inside another word must not
   * count. A coffee machine is not a cup of coffee.
   */
  it('only matches whole words', () => {
    const kaffe = mall('Kaffe', []);
    expect(foreslaMallForText([kaffe], 'Kaffebryggare 899,00')).toBeUndefined();
    expect(foreslaMallForText([kaffe], 'Kaffe 39,00')?.mall).toBe(kaffe);
  });

  it('counts punctuation as a word boundary, since OCR adds it', () => {
    expect(foreslaMallForText(MALLAR, 'Diesel, 95 liter')?.mall).toBe(DRIVMEDEL);
  });

  /*
   * Short words match by accident. "Ab" is on every Swedish receipt there is.
   */
  it('ignores words too short to mean anything', () => {
    const kort = mall('AB', ['ab']);
    expect(foreslaMallForText([kort], 'Lantbruk AB')).toBeUndefined();
  });

  it('prefers the longer match, which is the less likely accident', () => {
    const specifik = mall('Kraftfoder', []);
    const allman = mall('Foder', []);
    const forslag = foreslaMallForText([allman, specifik], 'Kraftfoder 25 kg');
    expect(forslag?.mall).toBe(specifik);
  });

  it('breaks a tie on how often the template has been used', () => {
    const a = mall('Diesel', []);
    const b = mall('Bensin', []);
    const anvandning = new Map([[b.id, 12]]);
    const forslag = foreslaMallForText([a, b], 'Bensin och diesel', anvandning);
    expect(forslag?.mall).toBe(b);
  });

  it('suggests nothing when the receipt says nothing it knows', () => {
    expect(foreslaMallForText(MALLAR, 'Blommor 129,00')).toBeUndefined();
    expect(foreslaMallForText(MALLAR, '')).toBeUndefined();
    expect(foreslaMallForText([], 'Kraftfoder')).toBeUndefined();
  });

  /*
   * 2026-10-28: a farm-shop receipt for salt licks was offered as "Fått
   * tillbaka moms", because the leaf's keyword "moms" is on every receipt.
   */
  it('does not match words every receipt prints', () => {
    const tillbaka = mall('Fått tillbaka moms', ['moms', 'skatteverket']);
    const text = 'Exenpel Lantbruk\nSaltsten 79,00\nTotalt inkl. moms 156,00\nKort';

    expect(foreslaMallForText([tillbaka], text)).toBeUndefined();
    expect(foreslaMallForText([tillbaka], 'Skatteverket återbetalning')?.mall).toBe(
      tillbaka,
    );
  });
});
