import { describe, expect, it } from 'vitest';

import { skrivBokbeskrivning } from '../../domain/bok/bokbeskrivning';
import { lasUppServerbok, tolkaServerbocker, type Upplasning } from './serverbocker';

/**
 * Stand-in encryption with the one property that matters here: text locked
 * with one passphrase opens with that passphrase and no other, and text
 * that was never locked opens for anyone.
 */
const las = (losenfras: string, text: string) => `${losenfras}::${text}`;
const upplasning: Upplasning = async (losenfras) => ({
  dekryptera: async (text) => {
    if (text.startsWith('{')) {
      return text;
    }
    if (losenfras !== undefined && text.startsWith(`${losenfras}::`)) {
      return text.slice(losenfras.length + 2);
    }
    throw new Error('Lösenfrasen stämmer inte.');
  },
});

const FIRMAN = skrivBokbeskrivning({ namn: 'Firman', profil: 'enskild_firma' });
const FORENINGEN = skrivBokbeskrivning({ namn: 'Föreningen', profil: 'forening' });

describe('tolkaServerbocker', () => {
  it('reads a book that syncs unencrypted', async () => {
    const [rad] = await tolkaServerbocker(
      [{ bok: 'kontera', beskrivning: FIRMAN }],
      [],
      [],
      upplasning,
    );

    expect(rad).toEqual({
      id: 'kontera',
      finnsHarSom: undefined,
      slag: 'lasbar',
      beskrivning: { namn: 'Firman', profil: 'enskild_firma' },
      losenfras: undefined,
    });
  });

  /*
   * One owner's books tend to share a passphrase, so the open book's is
   * tried - and remembered with the row, since the joined book needs it to
   * read its own entries.
   */
  it('opens a locked book with a passphrase this device already has', async () => {
    const [rad] = await tolkaServerbocker(
      [{ bok: 'b', beskrivning: las('delad fras', FORENINGEN) }],
      [],
      ['delad fras'],
      upplasning,
    );

    expect(rad).toMatchObject({ slag: 'lasbar', losenfras: 'delad fras' });
  });

  it('lists a book it cannot open as locked, not as an error', async () => {
    const chiffer = las('en annan fras', FORENINGEN);

    const [rad] = await tolkaServerbocker(
      [{ bok: 'b', beskrivning: chiffer }],
      [],
      ['delad fras'],
      upplasning,
    );

    expect(rad).toEqual({ id: 'b', finnsHarSom: undefined, slag: 'krypterad', chiffer });
  });

  it('says which books are already on the device, by their name here', async () => {
    const rader = await tolkaServerbocker(
      [
        { bok: 'kontera', beskrivning: FIRMAN },
        { bok: 'b', beskrivning: FORENINGEN },
      ],
      [{ id: 'kontera', namn: 'Min bokföring' }],
      [],
      upplasning,
    );

    expect(rader.map((rad) => rad.finnsHarSom)).toEqual(['Min bokföring', undefined]);
  });

  /*
   * Hard rule 11. A book whose description names a kind this version does
   * not know is shown with the reason; it is neither hidden nor offered.
   */
  it('shows a description it read but cannot use, with the reason', async () => {
    const [rad] = await tolkaServerbocker(
      [{ bok: 'b', beskrivning: '{"namn":"X","profil":"aktiebolag"}' }],
      [],
      [],
      upplasning,
    );

    expect(rad).toMatchObject({ slag: 'olaslig' });
    expect(rad?.slag === 'olaslig' && rad.fel).toContain('profil "aktiebolag"');
  });

  it('keeps the order the server gave', async () => {
    const rader = await tolkaServerbocker(
      [
        { bok: 'b', beskrivning: FORENINGEN },
        { bok: 'kontera', beskrivning: FIRMAN },
      ],
      [],
      [],
      upplasning,
    );

    expect(rader.map((rad) => rad.id)).toEqual(['b', 'kontera']);
  });
});

describe('lasUppServerbok', () => {
  it('opens a locked description with the passphrase that locked it', async () => {
    expect(
      await lasUppServerbok(las('rätt fras', FORENINGEN), 'rätt fras', upplasning),
    ).toEqual({ namn: 'Föreningen', profil: 'forening' });
  });

  it('says the passphrase is wrong when it is', async () => {
    await expect(
      lasUppServerbok(las('rätt fras', FORENINGEN), 'fel fras', upplasning),
    ).rejects.toThrow('Lösenfrasen stämmer inte');
  });
});
