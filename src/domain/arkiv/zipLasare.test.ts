import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { crc32 } from './zip';
import { bygg } from './zipTestByggare';
import {
  arZip,
  HOGSTA_STORLEK_PER_FIL,
  lasZipposter,
  siefilerUrValda,
  ZipFel,
  type Inflate,
} from './zipLasare';

/** The reference inflater, which refuses to pass the ceiling like the real one. */
const inflate: Inflate = async (data, hogst) => {
  const ut = inflateRawSync(data, { maxOutputLength: hogst });
  return new Uint8Array(ut);
};

const text = (s: string) => new TextEncoder().encode(s);
const SIE = text('#FLAGGA 0\r\n#SIETYP 4\r\n');
const alla = () => true;

describe('arZip', () => {
  it('tells a zip from a SIE file by how it begins', () => {
    expect(arZip(bygg([{ namn: 'a.se', data: SIE }]))).toBe(true);
    expect(arZip(text('#FLAGGA 0'))).toBe(false);
    expect(arZip(new Uint8Array())).toBe(false);
    // An archive with nothing in it is only the end record, and is a zip all the same.
    expect(arZip(bygg([]))).toBe(true);
  });
});

describe('lasZipposter', () => {
  it('unpacks a deflated and a stored entry', async () => {
    const zip = bygg([
      { namn: 'a.se', data: SIE },
      { namn: 'b.se', data: text('lagrad'), metod: 0 },
    ]);
    const ut = await lasZipposter(zip, inflate, alla);
    expect(ut.map((p) => [p.namn, new TextDecoder().decode(p.data)])).toEqual([
      ['a.se', new TextDecoder().decode(SIE)],
      ['b.se', 'lagrad'],
    ]);
  });

  it('reads sizes from the directory when the local header says zero', async () => {
    // How an archive written in one pass looks: the figures come after the data.
    const zip = bygg([{ namn: 'a.se', data: SIE, lokalaStorlekarNoll: true }]);
    expect((await lasZipposter(zip, inflate, alla))[0]?.data).toEqual(SIE);
  });

  it('finds the end of the archive past a comment', async () => {
    const zip = bygg([{ namn: 'a.se', data: SIE }], 'Skapad med ett program');
    expect(await lasZipposter(zip, inflate, alla)).toHaveLength(1);
  });

  it('skips directories and entries nobody asked for, without unpacking them', async () => {
    const zip = bygg([
      { namn: 'mapp/', data: new Uint8Array(), metod: 0 },
      // Garbage that would fail to inflate if it were tried.
      { namn: 'stor.bin', data: SIE, packad: new Uint8Array([1, 2, 3]) },
      { namn: 'mapp/a.se', data: SIE },
    ]);
    const ut = await lasZipposter(zip, inflate, (namn) => namn.endsWith('.se'));
    expect(ut.map((p) => p.namn)).toEqual(['mapp/a.se']);
  });

  it('refuses what is not a zip, and one cut off', async () => {
    await expect(
      lasZipposter(text('inte en zip alls, bara text'), inflate, alla),
    ).rejects.toThrow(ZipFel);
    const zip = bygg([{ namn: 'a.se', data: SIE }]);
    await expect(
      lasZipposter(zip.subarray(0, zip.length - 30), inflate, alla),
    ).rejects.toThrow(ZipFel);
  });

  it('refuses an encrypted entry, naming it', async () => {
    const zip = bygg([{ namn: 'hemlig.se', data: SIE, flaggor: 1 }]);
    await expect(lasZipposter(zip, inflate, alla)).rejects.toThrow(
      /hemlig\.se.*lösenordsskyddad/,
    );
  });

  it('refuses a method it cannot read, naming it', async () => {
    const zip = bygg([{ namn: 'a.se', data: SIE, metod: 99, packad: SIE }]);
    await expect(lasZipposter(zip, inflate, alla)).rejects.toThrow(/metod 99/);
  });

  it('refuses an entry whose checksum does not match what came out', async () => {
    const zip = bygg([{ namn: 'a.se', data: SIE, crc: 12345 }]);
    await expect(lasZipposter(zip, inflate, alla)).rejects.toThrow(/skadad/);
  });

  it('refuses an entry that unpacks to another size than the archive says', async () => {
    const zip = bygg([{ namn: 'a.se', data: SIE, storlek: SIE.length + 5 }]);
    await expect(lasZipposter(zip, inflate, alla)).rejects.toThrow();
  });

  it('refuses an entry that declares more than the ceiling, before unpacking anything', async () => {
    const zip = bygg([
      { namn: 'bomb.se', data: SIE, storlek: HOGSTA_STORLEK_PER_FIL + 1 },
    ]);
    let anrop = 0;
    await expect(
      lasZipposter(zip, async (d, h) => (anrop++, inflate(d, h)), alla),
    ).rejects.toThrow(/över 64 MB/);
    expect(anrop).toBe(0);
  });

  it('stops an entry that lies about its size by passing the figure it gave', async () => {
    // The archive says 5 bytes and the stream holds many more.
    const lang = new Uint8Array(100_000).fill(65);
    const zip = bygg([{ namn: 'a.se', data: lang, storlek: 5, crc: crc32(lang) }]);
    await expect(lasZipposter(zip, inflate, alla)).rejects.toThrow();
  });
});

describe('siefilerUrValda', () => {
  it('passes a SIE file through as it is', async () => {
    const ut = await siefilerUrValda([{ namn: 'a.se', innehall: SIE }], inflate);
    expect(ut.filer).toEqual([SIE]);
    expect(ut.urZip).toEqual([]);
  });

  it('opens a zip and takes its SIE files, leaving the rest', async () => {
    const zip = bygg([
      { namn: 'LASMIG.txt', data: text('hej') },
      { namn: 'SIE4 Exempelfil.SE', data: SIE },
      { namn: '__MACOSX/._SIE4 Exempelfil.SE', data: text('skräp') },
      { namn: 'mapp/._dold.se', data: text('skräp') },
      { namn: 'ar2.si', data: text('#FLAGGA 0') },
    ]);
    const ut = await siefilerUrValda([{ namn: 'sie.zip', innehall: zip }], inflate);
    expect(ut.urZip).toEqual(['SIE4 Exempelfil.SE', 'ar2.si']);
    expect(ut.filer[0]).toEqual(SIE);
  });

  it('mixes loose files and archives in the order picked', async () => {
    const zip = bygg([{ namn: 'b.se', data: text('#B') }]);
    const ut = await siefilerUrValda(
      [
        { namn: 'a.se', innehall: text('#A') },
        { namn: 'sie.zip', innehall: zip },
      ],
      inflate,
    );
    expect(ut.filer.map((f) => new TextDecoder().decode(f))).toEqual(['#A', '#B']);
  });

  it('says so when a zip holds no SIE file', async () => {
    const zip = bygg([{ namn: 'bild.png', data: text('x') }]);
    await expect(
      siefilerUrValda([{ namn: 'foton.zip', innehall: zip }], inflate),
    ).rejects.toThrow(/foton\.zip innehåller ingen SIE-fil/);
  });
});
