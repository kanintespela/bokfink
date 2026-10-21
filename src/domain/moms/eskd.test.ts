import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../belopp/ore';
import { kontonummer } from '../konto/konto';
import { datum } from '../tid/datum';
import type { Uuid } from '../id/uuidv7';
import { verifikatserie } from '../verifikat/serie';
import { bokfor, skapaUtkast } from '../verifikat/verifikat';
import { OkandRutaError, skrivEskd } from './eskd';
import { beraknaMomsrapport } from './momsrapport';

let raknare = 0;

function rapportMed(rader: readonly (readonly [string, string])[]) {
  const verifikat = bokfor(
    skapaUtkast({
      id: `019b76da-a800-7000-8000-${String((raknare += 1)).padStart(12, '0')}` as Uuid,
      datum: datum('2026-02-13'),
      beskrivning: 'test',
      konteringar: rader.map(([konto, kronor]) => ({
        konto: kontonummer(konto),
        belopp: oreFromKronor(kronor),
      })),
    }),
    {
      serie: verifikatserie('A'),
      nummer: raknare,
      bokfortDatum: datum('2026-02-13'),
      kalla: 'manuell',
    },
  );

  return beraknaMomsrapport({
    fran: datum('2026-01-01'),
    till: datum('2026-03-31'),
    verifikat: [verifikat],
  });
}

describe('skrivEskd', () => {
  const forsaljning = () =>
    rapportMed([
      ['1930', '12645.00'],
      ['2610', '-2528.98'],
      ['3010', '-10115.93'],
      ['3740', '-0.09'],
    ]);

  it('declares the encoding and the DTD the e-service expects', () => {
    const fil = skrivEskd({ organisationsnummer: '1212121212', rapport: forsaljning() });
    const rader = fil.split('\n');

    expect(rader[0]).toBe('<?xml version="1.0" encoding="ISO-8859-1"?>');
    expect(rader[1]).toContain('eSKDUpload-DTD Version 6.0');
    expect(rader[2]).toBe('<eSKDUpload Version="6.0">');
  });

  /*
   * The NE-bilaga asks for the personnummer with its century and the
   * momsdeklaration without, so the same number is typed both ways. The
   * century carries nothing the file needs.
   */
  it('takes a personnummer written with its century', () => {
    const fil = skrivEskd({
      organisationsnummer: '19121212-1212',
      rapport: forsaljning(),
    });
    expect(fil).toContain('<OrgNr>121212-1212</OrgNr>');
  });

  it('refuses twelve digits that do not start with a century', () => {
    expect(() =>
      skrivEskd({ organisationsnummer: '551212121212', rapport: forsaljning() }),
    ).toThrow('tio siffror');
  });

  it('writes the organisation number with its hyphen', () => {
    const fil = skrivEskd({ organisationsnummer: '1212121212', rapport: forsaljning() });
    expect(fil).toContain('<OrgNr>121212-1212</OrgNr>');
  });

  /*
   * A quarterly return is filed for the last month of the quarter. Confirmed
   * against the real filings, whose automatic transfers name their periods
   * 202503, 202506, 202509 and 202512.
   */
  it('names the period by its last month', () => {
    const fil = skrivEskd({ organisationsnummer: '1212121212', rapport: forsaljning() });
    expect(fil).toContain('<Period>202603</Period>');
  });

  it('writes the boxes in whole kronor with no decimals', () => {
    const fil = skrivEskd({ organisationsnummer: '1212121212', rapport: forsaljning() });

    expect(fil).toContain('<ForsMomsEjAnnan>10115</ForsMomsEjAnnan>');
    expect(fil).toContain('<MomsUtgHog>2528</MomsUtgHog>');
    expect(fil).toContain('<MomsBetala>2528</MomsBetala>');
  });

  it('leaves out boxes that are empty', () => {
    const fil = skrivEskd({ organisationsnummer: '1212121212', rapport: forsaljning() });
    expect(fil).not.toContain('MomsUtgMedel');
    expect(fil).not.toContain('MomsIngAvdr');
  });

  /*
   * A period with no VAT at all is still a return that has to be filed, and
   * what it says is that nothing is to be paid. Box 49 therefore carries a
   * zero where every other box is simply left out.
   */
  it('states a zero in box 49 for a period with no VAT', () => {
    const rapport = rapportMed([
      ['1930', '1000.00'],
      ['2018', '-1000.00'],
    ]);

    const fil = skrivEskd({ organisationsnummer: '1212121212', rapport });

    expect(fil).toContain('<MomsBetala>0</MomsBetala>');
    expect(fil).not.toContain('ForsMomsEjAnnan');
  });

  it('carries a note when there is one', () => {
    const fil = skrivEskd({
      organisationsnummer: '1212121212',
      rapport: forsaljning(),
      upplysning: 'Rättelse av kvartal 1',
    });
    expect(fil).toContain(
      '<TextUpplysningMoms>Rättelse av kvartal 1</TextUpplysningMoms>',
    );
  });

  /*
   * Reverse charge, which touches three boxes at once: the base, the VAT owed
   * on it, and the same VAT deducted again. All three have to reach the file
   * or the return says something that is not true.
   */
  it('writes all three boxes of a reverse charge purchase', () => {
    const rapport = rapportMed([
      ['4535', '1000.00'],
      ['2614', '-250.00'],
      ['2645', '250.00'],
      ['2013', '-1000.00'],
    ]);

    const fil = skrivEskd({ organisationsnummer: '1212121212', rapport });

    expect(fil).toContain('<InkopTjanstAnnatEg>-1000</InkopTjanstAnnatEg>');
    expect(fil).toContain('<MomsInkopUtgHog>250</MomsInkopUtgHog>');
    expect(fil).toContain('<MomsIngAvdr>250</MomsIngAvdr>');
    // Owed and deducted cancel, so nothing is paid.
    expect(fil).toContain('<MomsBetala>0</MomsBetala>');
  });

  it('writes a sale into the EU as its own box', () => {
    const rapport = rapportMed([
      ['1930', '26400.00'],
      ['3058', '-26400.00'],
    ]);

    const fil = skrivEskd({ organisationsnummer: '1212121212', rapport });
    expect(fil).toContain('<ForsVaruAnnatEg>26400</ForsVaruAnnatEg>');
  });

  /*
   * The guard should now be unreachable - every box the declaration has is
   * mapped - but it stays, because a form that gains a box should refuse by
   * name rather than write a tag nobody chose.
   */
  it('still refuses a box it has no name for', () => {
    const rapport = rapportMed([
      ['1930', '100.00'],
      ['3010', '-100.00'],
    ]);
    const uppdiktad = {
      ...rapport,
      rader: [
        ...rapport.rader,
        {
          ruta: {
            nummer: 99,
            rubrik: 'Finns inte',
            avsnitt: rapport.rader[0]!.ruta.avsnitt,
          },
          belopp: rapport.rader[0]!.belopp,
          exakt: rapport.rader[0]!.exakt,
        },
      ],
    };

    expect(() =>
      skrivEskd({ organisationsnummer: '1212121212', rapport: uppdiktad }),
    ).toThrow(OkandRutaError);
  });

  it('refuses an organisation number that is not ten digits', () => {
    expect(() =>
      skrivEskd({ organisationsnummer: '123', rapport: forsaljning() }),
    ).toThrow(TypeError);
  });
});
