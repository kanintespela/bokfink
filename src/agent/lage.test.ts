import { describe, expect, it } from 'vitest';

import { formatKronor, oreFromKronor } from '../domain/belopp/ore';
import type { Uuid } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import { skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import {
  bokfor,
  skapaUtkast,
  type BokfortVerifikat,
} from '../domain/verifikat/verifikat';
import { beskrivLage, sok, type Bocker } from './lage';

let raknare = 0;

function verifikat(dag: string, nummer: number, beskrivning: string): BokfortVerifikat {
  raknare += 1;
  return bokfor(
    skapaUtkast({
      id: `01990000-0000-7000-8000-${String(raknare).padStart(12, '0')}` as Uuid,
      datum: datum(dag),
      beskrivning,
      konteringar: [
        { konto: kontonummer('4010'), belopp: oreFromKronor('1250') },
        { konto: kontonummer('2013'), belopp: oreFromKronor('-1250') },
      ],
    }),
    { serie: verifikatserie('A'), nummer, bokfortDatum: datum(dag), kalla: 'manuell' },
  );
}

function bocker(): Bocker {
  const ar = skapaRakenskapsar({
    id: '01990000-0000-7000-8000-000000002026' as Uuid,
    start: datum('2026-01-01'),
    slut: datum('2026-12-31'),
    momslastTom: datum('2026-06-30'),
  });
  const poster = [
    verifikat('2026-03-02', 1, 'Foder, Lantmännen'),
    verifikat('2026-08-15', 2, 'Diesel, Circle K'),
  ];
  return {
    konton: new Map(
      [
        skapaKonto({ nummer: '4010', namn: 'Inköp av material och varor' }),
        skapaKonto({ nummer: '2013', namn: 'Eget uttag' }),
        skapaKonto({ nummer: '5460', namn: 'Gammalt konto', aktiv: false }),
      ].map((konto) => [konto.nummer, konto]),
    ),
    rakenskapsar: new Map([[ar.id, ar]]),
    verifikat: new Map(poster.map((post) => [post.id, post])),
    utkast: new Map(),
  };
}

describe('beskrivLage för en förening', () => {
  it("lists the association's own answers and not the firm's", () => {
    const text = beskrivLage(bocker(), 'forening');
    expect(text).toContain('(föreningens egna)');
    expect(text).toContain('Pengar in › Medlemsavgift (inkomst): 3610');
    expect(text).not.toContain('Djuren');
    expect(text).not.toContain('(BAS K1)');
  });

  it("is the firm's overview when it is not told otherwise", () => {
    expect(beskrivLage(bocker())).toContain('(BAS K1)');
  });
});

describe('beskrivLage', () => {
  it('lists the year with its lock, the active accounts and the latest verifikat', () => {
    const text = beskrivLage(bocker());

    expect(text).toContain('2026-01-01–2026-12-31 öppet, momslåst t.o.m. 2026-06-30');
    expect(text).toContain('4010 Inköp av material och varor');
    expect(text).not.toContain('Gammalt konto');
    // Newest first: last month's diesel before the foder in March.
    expect(text.indexOf('A2 2026-08-15 Diesel')).toBeLessThan(
      text.indexOf('A1 2026-03-02 Foder'),
    );
    expect(text).toContain(
      `4010 ${formatKronor(oreFromKronor('1250'))} / 2013 ${formatKronor(oreFromKronor('-1250'))}`,
    );
  });
});

describe('sok', () => {
  /*
   * A supplier's name read off a thermal receipt rarely keeps its dots, so
   * the search has to find Lantmännen from "lantmannen".
   */
  it('finds a description without its accents', () => {
    expect(sok(bocker(), 'lantmannen')).toContain('A1 2026-03-02 Foder, Lantmännen');
  });

  it('needs every word to match', () => {
    expect(sok(bocker(), 'foder circle')).toContain('Inga verifikat matchar');
  });

  it('refuses an empty search', () => {
    expect(() => sok(bocker(), '   ')).toThrow('Ange vad som ska sökas efter.');
  });
});
