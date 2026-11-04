import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { uuidv7 } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import { skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { FelBetalningError, oppnaFakturor } from '../domain/verifikat/reskontra';
import { verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast } from '../domain/verifikat/verifikat';
import { lasTillstand, skyddaBokfordaVerifikat } from './bokforing';
import { BokfinkDatabase } from './db';
import { registreraBetalning } from './fakturor';
import {
  bokforUtkast,
  skrivKonto,
  skrivRakenskapsar,
  type Skrivkontext,
} from './kommandon';

const kr = oreFromKronor;
let raknare = 0;
let ms = 1_788_554_000_000;
const kontext: Skrivkontext = {
  enhet: 'a',
  nu: () => '2026-04-10T08:00:00.000Z',
  nyttId: () => uuidv7((ms += 1), new Uint8Array(10).fill(5)),
};

async function bokMedFaktura() {
  const db = new BokfinkDatabase(`kontera-fakturor-${(raknare += 1)}`);
  skyddaBokfordaVerifikat(db);
  await db.open();
  await skrivRakenskapsar(
    db,
    kontext,
    skapaRakenskapsar({
      id: kontext.nyttId!(),
      start: datum('2026-01-01'),
      slut: datum('2026-12-31'),
    }),
  );
  for (const [nummer, namn] of [
    ['1500', 'Kundfordringar'],
    ['1930', 'Företagskonto'],
    ['2611', 'Utgående moms 25 %'],
    ['3000', 'Försäljning'],
  ] as const) {
    await skrivKonto(db, kontext, skapaKonto({ nummer, namn }));
  }
  const faktura = await bokforUtkast(
    db,
    kontext,
    skapaUtkast({
      id: kontext.nyttId!(),
      datum: datum('2026-03-01'),
      beskrivning: 'Kurs i biodling',
      mall: kontext.nyttId!(),
      konteringar: [
        { konto: kontonummer('1500'), belopp: kr('1250') },
        { konto: kontonummer('3000'), belopp: kr('-1000') },
        { konto: kontonummer('2611'), belopp: kr('-250') },
      ],
    }),
    verifikatserie('A'),
  );
  return { db, faktura };
}

describe('registreraBetalning', () => {
  it('books a part payment, then the rest, and the invoice is no longer open', async () => {
    const { db, faktura } = await bokMedFaktura();
    const betalkonto = kontonummer('1930');

    await registreraBetalning(db, kontext, faktura.id, {
      datum: datum('2026-03-20'),
      belopp: kr('500'),
      betalkonto,
    });
    let alla = [...(await lasTillstand(db)).verifikat.values()];
    expect(oppnaFakturor(alla).map((f) => f.kvar)).toEqual([kr('750')]);

    await registreraBetalning(db, kontext, faktura.id, {
      datum: datum('2026-04-02'),
      belopp: kr('750'),
      betalkonto,
    });
    alla = [...(await lasTillstand(db)).verifikat.values()];
    expect(oppnaFakturor(alla)).toEqual([]);
  });

  it('refuses to pay more than is left, from the books and not the screen', async () => {
    const { db, faktura } = await bokMedFaktura();
    const uppgifter = { datum: datum('2026-03-20'), betalkonto: kontonummer('1930') };
    await registreraBetalning(db, kontext, faktura.id, {
      ...uppgifter,
      belopp: kr('1000'),
    });

    await expect(
      registreraBetalning(db, kontext, faktura.id, { ...uppgifter, belopp: kr('300') }),
    ).rejects.toBeInstanceOf(FelBetalningError);
  });

  it('refuses an invoice that is not there', async () => {
    const { db } = await bokMedFaktura();
    await expect(
      registreraBetalning(db, kontext, kontext.nyttId!(), {
        datum: datum('2026-03-20'),
        belopp: kr('1'),
        betalkonto: kontonummer('1930'),
      }),
    ).rejects.toBeInstanceOf(FelBetalningError);
  });
});
