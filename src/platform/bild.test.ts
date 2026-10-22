import { describe, expect, it } from 'vitest';

import {
  bedomBild,
  begransaUtsnitt,
  fonsterstorlek,
  jpegnamn,
  malmatt,
  MAX_KANT,
  MINSTA_UTSNITT,
  trosklaLokalt,
  vridnaMatt,
} from './bild';

describe('malmatt', () => {
  it('leaves an image that is already small enough alone', () => {
    expect(malmatt(1200, 900)).toEqual({ bredd: 1200, hojd: 900 });
  });

  it('scales the longest edge down and keeps the proportions', () => {
    // A 12-megapixel phone photograph, 4032 x 3024.
    expect(malmatt(4032, 3024)).toEqual({ bredd: MAX_KANT, hojd: 1500 });
    expect(malmatt(3024, 4032)).toEqual({ bredd: 1500, hojd: MAX_KANT });
  });

  it('never scales up', () => {
    expect(malmatt(100, 50, 2000)).toEqual({ bredd: 100, hojd: 50 });
  });

  it('keeps a degenerate image at least one pixel wide', () => {
    expect(malmatt(10_000, 1)).toEqual({ bredd: 2000, hojd: 1 });
  });
});

describe('jpegnamn', () => {
  it('replaces the extension', () => {
    expect(jpegnamn('IMG_0042.HEIC')).toBe('IMG_0042.jpg');
    expect(jpegnamn('kvitto.png')).toBe('kvitto.jpg');
  });

  it('drops any path a browser might have included', () => {
    expect(jpegnamn('C:\\Bilder\\kvitto.png')).toBe('kvitto.jpg');
    expect(jpegnamn('/tmp/kvitto.png')).toBe('kvitto.jpg');
  });

  it('names a file that has no name at all', () => {
    expect(jpegnamn('')).toBe('underlag.jpg');
    expect(jpegnamn('.jpeg')).toBe('underlag.jpg');
  });
});

describe('begransaUtsnitt', () => {
  /*
   * Each edge snaps to its own nearest pixel rather than the width being
   * rounded as a unit, so the rectangle stays where the finger put it.
   */
  it('rounds a crop to whole pixels', () => {
    expect(
      begransaUtsnitt({ x: 10.4, y: 20.6, bredd: 100.2, hojd: 200.8 }, 400, 400),
    ).toEqual({ x: 10, y: 21, bredd: 101, hojd: 200 });
  });

  it('keeps a crop inside the picture', () => {
    expect(begransaUtsnitt({ x: -50, y: -50, bredd: 500, hojd: 500 }, 400, 300)).toEqual({
      x: 0,
      y: 0,
      bredd: 400,
      hojd: 300,
    });
  });

  it('accepts a rectangle dragged upwards and to the left', () => {
    // Finger started bottom right and ended top left: negative width.
    expect(
      begransaUtsnitt({ x: 300, y: 200, bredd: -100, hojd: -150 }, 400, 400),
    ).toEqual({
      x: 200,
      y: 50,
      bredd: 100,
      hojd: 150,
    });
  });

  /*
   * A tap that turned into a two-pixel drag is not a crop, and a picture of
   * nothing is worse than an uncropped receipt.
   */
  it('falls back to the whole picture when the crop is a slip', () => {
    expect(
      begransaUtsnitt({ x: 10, y: 10, bredd: MINSTA_UTSNITT - 1, hojd: 200 }, 400, 400),
    ).toEqual({ x: 0, y: 0, bredd: 400, hojd: 400 });
  });
});

describe('vridnaMatt', () => {
  it('swaps the sides for a quarter turn', () => {
    expect(vridnaMatt(4032, 3024, 90)).toEqual({ bredd: 3024, hojd: 4032 });
    expect(vridnaMatt(4032, 3024, 270)).toEqual({ bredd: 3024, hojd: 4032 });
  });

  it('leaves them alone for a half turn or none', () => {
    expect(vridnaMatt(4032, 3024, 0)).toEqual({ bredd: 4032, hojd: 3024 });
    expect(vridnaMatt(4032, 3024, 180)).toEqual({ bredd: 4032, hojd: 3024 });
  });
});

describe('fonsterstorlek', () => {
  it('scales with the picture and stays odd', () => {
    expect(fonsterstorlek(2000)).toBe(41);
    expect(fonsterstorlek(1500)).toBe(31);
  });

  it('stays sane for a very small or very large picture', () => {
    expect(fonsterstorlek(100)).toBe(15);
    expect(fonsterstorlek(100_000)).toBe(81);
  });
});

describe('trosklaLokalt', () => {
  /**
   * A receipt lying across a shadow: the paper is bright on the left and dim
   * on the right, and the ink reflects a fixed fraction of whatever light
   * falls on it - which is how ink behaves. The paper in the shadow is then
   * darker than the ink in the light, so no single threshold can separate
   * them and a local one can.
   */
  function skuggatPapper(bredd: number, hojd: number, textkolumner: readonly number[]) {
    const bild = new Uint8ClampedArray(bredd * hojd);
    for (let y = 0; y < hojd; y += 1) {
      for (let x = 0; x < bredd; x += 1) {
        const papper = 230 - Math.round((x / bredd) * 150);
        const text = textkolumner.includes(x % 20);
        bild[y * bredd + x] = text ? Math.round(papper * 0.3) : papper;
      }
    }
    return bild;
  }

  it('finds the text on both sides of a shadow', () => {
    const bredd = 200;
    const hojd = 60;
    const bild = skuggatPapper(bredd, hojd, [5, 6, 7]);

    const ut = trosklaLokalt(bild, bredd, hojd, 21);

    // A pixel of ink is black and a pixel of paper is white, in the bright
    // half and in the dim half alike.
    for (const x of [5, 105, 185]) {
      expect(ut[30 * bredd + x]).toBe(0);
      expect(ut[30 * bredd + x + 5]).toBe(255);
    }
  });

  it('leaves a blank page blank', () => {
    const bredd = 40;
    const hojd = 20;
    const tom = new Uint8ClampedArray(bredd * hojd).fill(240);
    const ut = trosklaLokalt(tom, bredd, hojd, 15);
    expect([...ut].every((varde) => varde === 255)).toBe(true);
  });
});

describe('bedomBild', () => {
  const BREDD = 1000;
  const HOJD = 800;

  /** A page of paper with lines of ink on it, at a given brightness. */
  function papper(bredd: number, hojd: number, ljus: number) {
    const bild = new Uint8ClampedArray(bredd * hojd).fill(ljus);
    for (let y = 4; y < hojd; y += 8) {
      for (let x = 0; x < bredd; x += 1) {
        // Ink reflects a fraction of the light falling on it.
        bild[y * bredd + x] = Math.round(ljus * 0.25);
      }
    }
    return bild;
  }

  /**
   * A photograph with no detail left in it: light falling across a page and
   * nothing else, which is what an out-of-focus receipt comes to.
   */
  function baraLjus(bredd: number, hojd: number, styrka = 1) {
    const bild = new Uint8ClampedArray(bredd * hojd);
    for (let y = 0; y < hojd; y += 1) {
      for (let x = 0; x < bredd; x += 1) {
        bild[y * bredd + x] = Math.round((60 + (x / bredd) * 180) * styrka);
      }
    }
    return bild;
  }

  it('passes a bright, sharp, large picture', () => {
    expect(bedomBild(papper(BREDD, HOJD, 200), BREDD, HOJD)).toBe('duger');
  });

  /*
   * The receipt photographed in a dark car, which read as "Totalt exkl. aom
   * 0.00" and offered a weight in kilos as the amount.
   */
  it('calls a dark picture dark', () => {
    expect(bedomBild(papper(BREDD, HOJD, 70), BREDD, HOJD)).toBe('mork');
  });

  /*
   * The threshold itself comes from the real photographs - 1,4 for the one
   * that could not be read against 5,5 and 7,1 for the two that could - and
   * this is the extreme it protects against: a picture with no edges left.
   */
  it('calls a picture with no detail in it blurred', () => {
    expect(bedomBild(baraLjus(BREDD, HOJD), BREDD, HOJD)).toBe('suddig');
  });

  it('calls a picture with too few pixels small', () => {
    expect(bedomBild(papper(400, 300, 200), 400, 300)).toBe('liten');
  });

  /*
   * Darkness is reported before blur. They need different remedies - more
   * light, or a steadier hand - and the first is the one that was wrong.
   */
  it('reports the darkness of a dark picture with no detail', () => {
    expect(bedomBild(baraLjus(BREDD, HOJD, 0.4), BREDD, HOJD)).toBe('mork');
  });
});
