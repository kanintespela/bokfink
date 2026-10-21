import { describe, expect, it } from 'vitest';

import { lasfel } from './ocr';

describe('lasfel', () => {
  // The message from the iPhone that could not read a PDF's text.
  const motorn = new TypeError("undefined is not a function (near '...e of t...')");

  it('says what failed and what to do, in Swedish', () => {
    const fel = lasfel(motorn, 'application/pdf');
    expect(fel.message).toMatch(/^Appen kunde inte läsa texten i PDF:en\./);
    expect(fel.message).toContain('Underlaget är sparat');
  });

  it('keeps what the engine said, so it can be passed on', () => {
    const fel = lasfel(motorn, 'application/pdf');
    expect(fel.message).toContain(
      "(Tekniskt fel: undefined is not a function (near '...e of t...'))",
    );
    expect(fel.cause).toBe(motorn);
  });

  it('speaks of a picture when it was a picture', () => {
    expect(lasfel('ingen motor', 'image/jpeg').message).toMatch(
      /^Appen kunde inte läsa texten på bilden\..*Tekniskt fel: ingen motor/,
    );
  });
});
