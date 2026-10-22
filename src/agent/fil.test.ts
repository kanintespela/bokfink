import { describe, expect, it } from 'vitest';

import { KVALITET, MAX_KANT } from '../platform/bild';
import { forberedUnderlag, underlagsnamn, type Bildkodare } from './fil';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff]);

const lasFil = async () => PDF;

describe('forberedUnderlag', () => {
  it('keeps a PDF byte for byte', async () => {
    const kodare: Bildkodare = async () => {
      throw new Error('a PDF must not be re-encoded');
    };

    expect(await forberedUnderlag('/tmp/faktura.PDF', 'namn', lasFil, kodare)).toEqual({
      data: PDF,
      mime: 'application/pdf',
      filnamn: 'namn.pdf',
    });
  });

  /*
   * The same bounds as the phone's camera path, so a receipt sent through
   * the assistant takes the same room in the phone's storage as one
   * photographed in the app.
   */
  it('re-encodes an image to JPEG within the app’s bounds', async () => {
    const anrop: unknown[] = [];
    const kodare: Bildkodare = async (sokvag, installning) => {
      anrop.push({ sokvag, ...installning });
      return JPEG;
    };

    for (const namn of ['photo.jpeg', 'IMG_0220.PNG', 'bild.heic']) {
      const forberedd = await forberedUnderlag(`/tmp/${namn}`, 'kvitto', lasFil, kodare);
      expect(forberedd).toEqual({
        data: JPEG,
        mime: 'image/jpeg',
        filnamn: 'kvitto.jpg',
      });
    }
    expect(anrop[0]).toEqual({
      sokvag: '/tmp/photo.jpeg',
      maxKant: MAX_KANT,
      kvalitet: KVALITET,
    });
  });

  it('refuses a file that is neither an image nor a PDF', async () => {
    await expect(
      forberedUnderlag('/tmp/kvitto.docx', 'kvitto', lasFil, async () => JPEG),
    ).rejects.toThrow('varken en bild eller en PDF');
  });
});

describe('underlagsnamn', () => {
  it('names the file by date and what was bought, in plain ASCII', () => {
    expect(underlagsnamn('2026-09-04', 'Foder, Lantmännen', 0)).toBe(
      '2026-09-04-foder-lantmannen',
    );
  });

  it('numbers the second and later files of one draft', () => {
    expect(underlagsnamn('2026-09-04', 'Faktura', 1)).toBe('2026-09-04-faktura-2');
  });

  it('falls back to the date when nothing in the description survives', () => {
    expect(underlagsnamn('2026-09-04', '???', 0)).toBe('2026-09-04');
  });

  it('keeps a long description short and without a trailing dash', () => {
    const namn = underlagsnamn(
      '2026-09-04',
      'Stängselmaterial och grindar till nya hagen vid ladan - del ett',
      0,
    );
    expect(namn.length).toBeLessThanOrEqual('2026-09-04-'.length + 40);
    expect(namn.endsWith('-')).toBe(false);
  });
});
