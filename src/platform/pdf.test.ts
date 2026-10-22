import { describe, expect, it } from 'vitest';

import { laggUtText, lasSidtext, MAX_PIXLAR, ritskala } from './pdf';

/** A fragment as pdf.js hands it over: text and where on the page it sits. */
const post = (x: number, y: number, str: string) => ({
  str,
  transform: [1, 0, 0, 1, x, y],
});

describe('laggUtText', () => {
  /*
   * A PDF has no lines. It has fragments with coordinates, and the interpreter
   * that reads them was written for OCR output - so they have to be laid back
   * out as text, in reading order.
   */
  it('puts fragments on the same line back together, left to right', () => {
    const text = laggUtText([
      post(300, 700, 'ATT BETALA'),
      post(60, 700, 'Totalt exkl moms'),
      post(60, 740, 'Fakturadatum 2026-08-18'),
    ]);

    // Indented to where they stood on the page: the left margin is a column
    // like any other, and the columns are the point.
    expect(text.split('\n')).toEqual([
      '            Fakturadatum 2026-08-18',
      expect.stringMatching(/^ {12}Totalt exkl moms +ATT BETALA$/),
    ]);
  });

  it('reads the page downwards, which is upwards in a PDF', () => {
    const text = laggUtText([post(60, 100, 'sist'), post(60, 700, 'först')]);
    expect(text).toBe('            först\n            sist');
  });

  /*
   * The reason the columns are kept: a totals row has five figures and only
   * the one under "ATT BETALA" is the amount to book. The interpreter matches
   * them by character position, so the position has to survive.
   */
  it('keeps a figure under its own heading', () => {
    const text = laggUtText([
      post(60, 700, 'Totalt exkl moms'),
      post(300, 700, 'ATT BETALA'),
      post(70, 680, '400,00'),
      post(310, 680, '500,00'),
    ]);

    const [rubriker, siffror] = text.split('\n');
    expect(rubriker?.indexOf('ATT BETALA')).toBeGreaterThan(20);
    // Within a character or two of the heading it belongs to.
    expect(
      Math.abs(
        (siffror?.indexOf('500,00') ?? 0) - (rubriker?.indexOf('ATT BETALA') ?? 0),
      ),
    ).toBeLessThanOrEqual(2);
  });

  it('ignores fragments that are only whitespace', () => {
    expect(laggUtText([post(60, 700, '   '), post(60, 700, 'text')])).toBe(
      '            text',
    );
  });

  it('has nothing to say about an empty page', () => {
    expect(laggUtText([])).toBe('');
  });
});

describe('lasSidtext', () => {
  /** A page whose text arrives in chunks, as pdf.js streams it. */
  function sida(...bitar: (readonly ReturnType<typeof post>[])[]) {
    return {
      streamTextContent() {
        const strom = new ReadableStream<unknown>({
          start(styrning) {
            bitar.forEach((items) => styrning.enqueue({ items, styles: {} }));
            styrning.close();
          },
        });
        // As in Safari, where a ReadableStream cannot be walked with for await.
        Object.defineProperty(strom, Symbol.asyncIterator, { value: undefined });
        Object.defineProperty(strom, 'values', { value: undefined });
        return strom;
      },
    };
  }

  it('collects every chunk without iterating the stream', async () => {
    const poster = await lasSidtext(
      sida([post(60, 700, 'ATT BETALA')], [post(60, 680, '500,00')]),
    );
    expect(poster.map((p) => p.str)).toEqual(['ATT BETALA', '500,00']);
  });

  it('has nothing to say about a page without text', async () => {
    expect(await lasSidtext(sida())).toEqual([]);
  });
});

describe('ritskala', () => {
  const a4 = { width: 595, height: 842 };

  it('fills the width in device pixels', () => {
    // 375 CSS pixels on a 3x screen is 1125 device pixels across.
    expect(ritskala(a4, 375, 3) * a4.width).toBeCloseTo(1125);
  });

  it('stays sharp on a plain screen too', () => {
    expect(ritskala(a4, 595, 1)).toBe(1);
  });

  it('stays inside what Safari will draw', () => {
    // Zoomed to 2.5 times a phone's width on a 3x screen: 2812 x 3979
    // device pixels, 11.2 million - under the limit, so untouched.
    expect(ritskala(a4, 937.5, 3)).toBeCloseTo((937.5 * 3) / 595);

    // Twice that is 44.8 million, and has to come down to the limit.
    const skala = ritskala(a4, 1875, 3);
    expect(a4.width * skala * a4.height * skala).toBeCloseTo(MAX_PIXLAR, -2);
  });
});
