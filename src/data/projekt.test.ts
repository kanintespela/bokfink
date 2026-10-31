import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { bygg, LoggkonfliktError, type Handelse } from '../domain/handelse/handelse';
import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import { OgiltigtProjektError, skapaProjekt } from '../domain/projekt/projekt';
import { skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { skapaUtkast } from '../domain/verifikat/verifikat';
import { exportera, importera } from './backup';
import {
  lasLogg,
  lasTillstand,
  OforanderligtVerifikatError,
  skyddaBokfordaVerifikat,
} from './bokforing';
import { KonteraDatabase } from './db';
import { VERIFIKAT_TABLE } from './schema';
import {
  andraProjektet,
  annulleraVerifikat,
  AvslutatProjektError,
  bokforUtkast,
  OkantProjektError,
  rattaVerifikat,
  skrivKonto,
  skrivProjekt,
  skrivRakenskapsar,
  sparaUtkast,
  type Skrivkontext,
} from './kommandon';
import { hashaFil } from '../platform/hash';

let raknare = 0;
let klockslag = 1_788_554_000_000;
const nyDb = async () => {
  const db = new KonteraDatabase(`kontera-projekt-${(raknare += 1)}`);
  skyddaBokfordaVerifikat(db);
  await db.open();
  return db;
};
const kontext: Skrivkontext = {
  enhet: 'enhet-a',
  nu: () => '2026-10-30T08:00:00.000Z',
  nyttId: () => uuidv7((klockslag += 1), new Uint8Array(10).fill(7)),
};
const kr = oreFromKronor;
const A = verifikatserie('A');

async function bok() {
  const db = await nyDb();
  await skrivKonto(db, kontext, skapaKonto({ nummer: '1930', namn: 'Bank' }));
  await skrivKonto(db, kontext, skapaKonto({ nummer: '5020', namn: 'El' }));
  await skrivRakenskapsar(
    db,
    kontext,
    skapaRakenskapsar({
      id: '019b76da-a800-7000-8000-000000002026' as Uuid,
      start: datum('2026-01-01'),
      slut: datum('2026-12-31'),
    }),
  );
  return db;
}

/** A utkast of 1 000 kr for electricity, the cost line on a project if one is given. */
function utkast(projekt?: Uuid, extra: { annullerar?: Uuid } = {}) {
  return skapaUtkast({
    id: kontext.nyttId!(),
    datum: datum('2026-06-01'),
    beskrivning: 'Elräkning',
    konteringar: [
      {
        konto: kontonummer('5020'),
        belopp: kr('1000'),
        ...(projekt === undefined ? {} : { projekt }),
      },
      { konto: kontonummer('1930'), belopp: kr('-1000') },
    ],
    ...extra,
  });
}

describe('projekt', () => {
  it('is created, found again, and renamed or finished without its code changing', async () => {
    const db = await bok();
    const projekt = await skrivProjekt(db, kontext, { kod: 'P2026', namn: 'Läger 2026' });
    expect((await lasTillstand(db)).projekt.get(projekt.id)).toEqual(projekt);

    await andraProjektet(db, kontext, projekt.id, {
      namn: 'Sommarläger',
      avslutat: true,
    });
    expect((await lasTillstand(db)).projekt.get(projekt.id)).toEqual({
      ...projekt,
      namn: 'Sommarläger',
      avslutat: true,
    });
  });

  it('refuses a second project with the same code, whatever its case', async () => {
    const db = await bok();
    await skrivProjekt(db, kontext, { kod: 'Leader-28', namn: 'Leader' });
    await expect(
      skrivProjekt(db, kontext, { kod: 'LEADER-28', namn: 'Annat' }),
    ).rejects.toBeInstanceOf(OgiltigtProjektError);
    expect((await lasTillstand(db)).projekt.size).toBe(1);
  });
});

describe('budget på ett projekt', () => {
  const budget = [
    { konto: kontonummer('6100'), belopp: kr('10000') },
    { konto: kontonummer('3980'), belopp: kr('20000') },
  ];

  it('is set, read back in account order, replaced and taken away', async () => {
    const db = await bok();
    const projekt = await skrivProjekt(db, kontext, { kod: 'P2026', namn: 'Läger' });

    await andraProjektet(db, kontext, projekt.id, { budget });
    expect(
      (await lasTillstand(db)).projekt.get(projekt.id)?.budget?.map((post) => post.konto),
    ).toEqual(['3980', '6100']);

    await andraProjektet(db, kontext, projekt.id, { budget: [budget[0]!] });
    expect((await lasTillstand(db)).projekt.get(projekt.id)?.budget).toEqual([budget[0]]);

    await andraProjektet(db, kontext, projekt.id, { budget: [] });
    expect((await lasTillstand(db)).projekt.get(projekt.id)).toEqual(projekt);
  });

  it('is refused for an account that cannot be budgeted, and nothing changes', async () => {
    const db = await bok();
    const projekt = await skrivProjekt(db, kontext, { kod: 'P2026', namn: 'Läger' });
    await expect(
      andraProjektet(db, kontext, projekt.id, {
        budget: [{ konto: kontonummer('1930'), belopp: kr('100') }],
      }),
    ).rejects.toBeInstanceOf(OgiltigtProjektError);
    expect((await lasTillstand(db)).projekt.get(projekt.id)).toEqual(projekt);
  });

  it('survives a rebuild from the log and a backup, and a rename leaves it alone', async () => {
    const db = await bok();
    const projekt = await skrivProjekt(db, kontext, { kod: 'P2026', namn: 'Läger' });
    await andraProjektet(db, kontext, projekt.id, { budget });
    await andraProjektet(db, kontext, projekt.id, { namn: 'Sommarläger' });

    const franLogg = bygg(await lasLogg(db)).projekt.get(projekt.id);
    const franTabell = (await lasTillstand(db)).projekt.get(projekt.id);
    expect(franLogg).toEqual(franTabell);
    expect(franLogg?.budget).toHaveLength(2);

    const ny = await nyDb();
    await importera(ny, await exportera(db), { hasha: hashaFil });
    expect((await lasTillstand(ny)).projekt.get(projekt.id)).toEqual(franTabell);
  });
});

describe('en konteringsrad på ett projekt', () => {
  it('is booked with its project and reads back with it', async () => {
    const db = await bok();
    const projekt = await skrivProjekt(db, kontext, { kod: 'P2026', namn: 'Läger' });
    const verifikat = await bokforUtkast(db, kontext, utkast(projekt.id), A);

    const lagrat = (await lasTillstand(db)).verifikat.get(verifikat.id);
    expect(lagrat?.konteringar[0]?.projekt).toBe(projekt.id);
    // The other line is an ordinary one: a project is not forced on every line.
    expect(lagrat?.konteringar[1]).not.toHaveProperty('projekt');
  });

  it('is refused for a project that does not exist, and nothing is booked', async () => {
    const db = await bok();
    const okant = '019b76da-a800-7000-8000-000000009999' as Uuid;
    await expect(bokforUtkast(db, kontext, utkast(okant), A)).rejects.toBeInstanceOf(
      OkantProjektError,
    );
    await expect(sparaUtkast(db, kontext, utkast(okant))).rejects.toBeInstanceOf(
      OkantProjektError,
    );
    expect((await lasTillstand(db)).verifikat.size).toBe(0);
    expect((await lasTillstand(db)).utkast.size).toBe(0);
  });

  it('is refused for a finished project, until it is opened again', async () => {
    const db = await bok();
    const projekt = await skrivProjekt(db, kontext, { kod: 'P2026', namn: 'Läger' });
    await andraProjektet(db, kontext, projekt.id, { avslutat: true });

    await expect(bokforUtkast(db, kontext, utkast(projekt.id), A)).rejects.toBeInstanceOf(
      AvslutatProjektError,
    );
    await expect(sparaUtkast(db, kontext, utkast(projekt.id))).rejects.toThrow(
      'är avslutat',
    );
    expect((await lasTillstand(db)).verifikat.size).toBe(0);

    await andraProjektet(db, kontext, projekt.id, { avslutat: false });
    await expect(bokforUtkast(db, kontext, utkast(projekt.id), A)).resolves.toBeDefined();
  });

  it('can still be reversed once its project is finished, and the reversal carries the project', async () => {
    const db = await bok();
    const projekt = await skrivProjekt(db, kontext, { kod: 'P2026', namn: 'Läger' });
    const original = await bokforUtkast(db, kontext, utkast(projekt.id), A);
    await andraProjektet(db, kontext, projekt.id, { avslutat: true });

    const annullering = await annulleraVerifikat(
      db,
      kontext,
      original,
      datum('2026-06-02'),
    );
    expect(annullering.konteringar[0]).toMatchObject({
      konto: '5020',
      belopp: kr('-1000'),
      projekt: projekt.id,
    });
  });
});

describe('rättelse av projekt på en bokförd rad', () => {
  it('puts a project on a row after booking, with when and who, and moves no money', async () => {
    const db = await bok();
    const projekt = await skrivProjekt(db, kontext, { kod: 'P2026', namn: 'Läger' });
    const original = await bokforUtkast(db, kontext, utkast(), A);

    await rattaVerifikat(db, kontext, original, {
      projekt: [{ rad: 0, projekt: projekt.id }],
    });

    const lagrat = (await lasTillstand(db)).verifikat.get(original.id);
    expect(lagrat?.konteringar[0]).toMatchObject({
      konto: '5020',
      belopp: kr('1000'),
      projekt: projekt.id,
    });
    expect(lagrat?.konteringar[1]).toEqual(original.konteringar[1]);
    expect(lagrat?.rattelser).toEqual([
      {
        nar: '2026-10-30T08:00:00.000Z',
        enhet: 'enhet-a',
        falt: 'projekt',
        rad: 0,
        fran: '',
        till: projekt.id,
      },
    ]);
  });

  it('moves a row from one project to another and takes it off again', async () => {
    const db = await bok();
    const ett = await skrivProjekt(db, kontext, { kod: 'P1', namn: 'Ett' });
    const tva = await skrivProjekt(db, kontext, { kod: 'P2', namn: 'Två' });
    const original = await bokforUtkast(db, kontext, utkast(ett.id), A);

    await rattaVerifikat(db, kontext, original, {
      projekt: [{ rad: 0, projekt: tva.id }],
    });
    const flyttat = (await lasTillstand(db)).verifikat.get(original.id)!;
    expect(flyttat.konteringar[0]?.projekt).toBe(tva.id);

    await rattaVerifikat(db, kontext, flyttat, { projekt: [{ rad: 0, projekt: null }] });
    const borta = (await lasTillstand(db)).verifikat.get(original.id)!;
    expect(borta.konteringar[0]).not.toHaveProperty('projekt');
    expect(borta.rattelser?.map((post) => [post.fran, post.till])).toEqual([
      [ett.id, tva.id],
      [tva.id, ''],
    ]);
  });

  it('is refused for a project that does not exist, or is finished, and changes nothing', async () => {
    const db = await bok();
    const avslutat = await skrivProjekt(db, kontext, { kod: 'P1', namn: 'Ett' });
    const original = await bokforUtkast(db, kontext, utkast(), A);
    await andraProjektet(db, kontext, avslutat.id, { avslutat: true });

    await expect(
      rattaVerifikat(db, kontext, original, {
        projekt: [{ rad: 0, projekt: '019b76da-a800-7000-8000-000000009999' as Uuid }],
      }),
    ).rejects.toBeInstanceOf(OkantProjektError);
    await expect(
      rattaVerifikat(db, kontext, original, {
        projekt: [{ rad: 0, projekt: avslutat.id }],
      }),
    ).rejects.toBeInstanceOf(AvslutatProjektError);

    const lagrat = (await lasTillstand(db)).verifikat.get(original.id);
    expect(lagrat?.rattelser).toBeUndefined();
    expect(lagrat?.konteringar[0]).not.toHaveProperty('projekt');
  });

  it('may take a row off a project that has since been finished', async () => {
    const db = await bok();
    const projekt = await skrivProjekt(db, kontext, { kod: 'P1', namn: 'Ett' });
    const original = await bokforUtkast(db, kontext, utkast(projekt.id), A);
    await andraProjektet(db, kontext, projekt.id, { avslutat: true });

    await rattaVerifikat(db, kontext, original, { projekt: [{ rad: 0, projekt: null }] });
    expect(
      (await lasTillstand(db)).verifikat.get(original.id)?.konteringar[0],
    ).not.toHaveProperty('projekt');
  });

  it('is corrected together with a description and a date, one rättelse for each thing', async () => {
    const db = await bok();
    const projekt = await skrivProjekt(db, kontext, { kod: 'P1', namn: 'Ett' });
    const original = await bokforUtkast(db, kontext, utkast(), A);

    await rattaVerifikat(db, kontext, original, {
      beskrivning: 'Elräkning juni',
      datum: datum('2026-06-02'),
      projekt: [{ rad: 0, projekt: projekt.id }],
    });
    expect(
      (await lasTillstand(db)).verifikat.get(original.id)?.rattelser?.map((p) => p.falt),
    ).toEqual(['beskrivning', 'datum', 'projekt']);
  });

  it('cannot be done around the correction: a changed project with nothing recorded is refused', async () => {
    const db = await bok();
    const projekt = await skrivProjekt(db, kontext, { kod: 'P1', namn: 'Ett' });
    const original = await bokforUtkast(db, kontext, utkast(), A);

    await expect(
      db.table(VERIFIKAT_TABLE).update(original.id, {
        konteringar: [
          { ...original.konteringar[0], projekt: projekt.id },
          original.konteringar[1],
        ],
      }),
    ).rejects.toBeInstanceOf(OforanderligtVerifikatError);
    // Nor with a rättelse that says something else than what was done.
    await expect(
      db.table(VERIFIKAT_TABLE).update(original.id, {
        konteringar: [
          { ...original.konteringar[0], projekt: projekt.id },
          original.konteringar[1],
        ],
        rattelser: [
          {
            nar: '2026-10-30T08:00:00.000Z',
            enhet: 'enhet-a',
            falt: 'projekt',
            rad: 1,
            fran: '',
            till: projekt.id,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(OforanderligtVerifikatError);
    // And never the money, even with a rättelse alongside.
    await expect(
      db.table(VERIFIKAT_TABLE).update(original.id, {
        konteringar: [
          { ...original.konteringar[0], belopp: kr('999'), projekt: projekt.id },
          original.konteringar[1],
        ],
        rattelser: [
          {
            nar: '2026-10-30T08:00:00.000Z',
            enhet: 'enhet-a',
            falt: 'projekt',
            rad: 0,
            fran: '',
            till: projekt.id,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(OforanderligtVerifikatError);
  });

  it('rebuilds from the log to the same row, and survives a backup', async () => {
    const db = await bok();
    const projekt = await skrivProjekt(db, kontext, { kod: 'P1', namn: 'Ett' });
    const original = await bokforUtkast(db, kontext, utkast(), A);
    await rattaVerifikat(db, kontext, original, {
      projekt: [{ rad: 0, projekt: projekt.id }],
    });

    const franLogg = bygg(await lasLogg(db)).verifikat.get(original.id);
    const franTabell = (await lasTillstand(db)).verifikat.get(original.id);
    expect(franLogg).toEqual(franTabell);
    expect(franLogg?.konteringar[0]?.projekt).toBe(projekt.id);

    const ny = await nyDb();
    await importera(ny, await exportera(db), { hasha: hashaFil });
    expect((await lasTillstand(ny)).verifikat.get(original.id)).toEqual(franTabell);
  });
});

describe('loggen', () => {
  it('rebuilds the same projects as the tables hold', async () => {
    const db = await bok();
    const projekt = await skrivProjekt(db, kontext, { kod: 'P2026', namn: 'Läger' });
    await andraProjektet(db, kontext, projekt.id, { namn: 'Sommarläger' });
    await bokforUtkast(db, kontext, utkast(projekt.id), A);

    const frangLogg = bygg(await lasLogg(db));
    const franTabeller = await lasTillstand(db);
    expect([...frangLogg.projekt]).toEqual([...franTabeller.projekt]);
    expect([...frangLogg.verifikat.values()][0]?.konteringar[0]?.projekt).toBe(
      projekt.id,
    );
  });

  it('says so when a project is changed before it was created, instead of guessing', () => {
    const andrat: Handelse = {
      id: kontext.nyttId!(),
      enhet: 'enhet-a',
      tidpunkt: '2026-10-30T08:00:00.000Z',
      typ: 'projekt.andrat',
      projektId: '019b76da-a800-7000-8000-000000009999' as Uuid,
      namn: 'x',
    };
    expect(() => bygg([andrat])).toThrow(LoggkonfliktError);
  });

  it('refuses the same project created twice in the log', () => {
    const projekt = skapaProjekt({ id: kontext.nyttId!(), kod: 'P1', namn: 'Ett' });
    const skapat = (): Handelse => ({
      id: kontext.nyttId!(),
      enhet: 'enhet-a',
      tidpunkt: '2026-10-30T08:00:00.000Z',
      typ: 'projekt.skapat',
      projekt,
    });
    expect(() => bygg([skapat(), skapat()])).toThrow(LoggkonfliktError);
  });

  it('follows a backup to another device, projects and the lines on them', async () => {
    const db = await bok();
    const projekt = await skrivProjekt(db, kontext, { kod: 'P2026', namn: 'Läger' });
    const verifikat = await bokforUtkast(db, kontext, utkast(projekt.id), A);

    const ny = await nyDb();
    await importera(ny, await exportera(db), { hasha: hashaFil });
    const tillstand = await lasTillstand(ny);
    expect(tillstand.projekt.get(projekt.id)?.kod).toBe('P2026');
    expect(tillstand.verifikat.get(verifikat.id)?.konteringar[0]?.projekt).toBe(
      projekt.id,
    );
  });
});
