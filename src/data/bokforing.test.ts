import 'fake-indexeddb/auto';

import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';

import { oreFromKronor } from '../domain/belopp/ore';
import { bygg, type Handelse } from '../domain/handelse/handelse';
import { uuidv7, type Uuid } from '../domain/id/uuidv7';
import { kontonummer, skapaKonto } from '../domain/konto/konto';
import { skapaRakenskapsar } from '../domain/rakenskapsar/rakenskapsar';
import { datum } from '../domain/tid/datum';
import { verifikatserie } from '../domain/verifikat/serie';
import { sha256, skapaUnderlag } from '../domain/underlag/underlag';
import { bokfor, skapaUtkast } from '../domain/verifikat/verifikat';
import {
  lasLogg,
  lasTillstand,
  lasVerifikat,
  OforanderligtVerifikatError,
  OkantRakenskapsarError,
  senastBokfort,
  senastBokforda,
  skyddaBokfordaVerifikat,
  tillampa,
  tillampaAlla,
  type VerifikatRad,
} from './bokforing';
import { KonteraDatabase } from './db';
import { latestSchemaVersion, VERIFIKAT_TABLE } from './schema';

let raknare = 0;
const uniqueName = () => `kontera-bokforing-${(raknare += 1)}`;

let klockslag = 1_788_554_000_000;
const nyttId = (): Uuid => uuidv7((klockslag += 1), new Uint8Array(10).fill(3));

const huvud = () => ({
  id: nyttId(),
  enhet: 'enhet-a',
  tidpunkt: '2026-09-05T08:00:00.000Z',
});

const AR_2026 = '019b76da-a800-7000-8000-000000002026' as Uuid;
const AR_2025 = '019b76da-a800-7000-8000-000000002025' as Uuid;

const arHandelse = (id: Uuid, ar: number): Handelse => ({
  ...huvud(),
  typ: 'rakenskapsar.skapat',
  rakenskapsar: skapaRakenskapsar({
    id,
    start: datum(`${ar}-01-01`),
    slut: datum(`${ar}-12-31`),
  }),
});

const kontoHandelse = (nummer: string, namn: string): Handelse => ({
  ...huvud(),
  typ: 'konto.skapat',
  konto: skapaKonto({ nummer, namn }),
});

/** Narrower than Handelse, so a caller can reach the verifikat it carries. */
function verifikatHandelse(
  serie: string,
  nummer: number,
  datumtext: string,
  beskrivning = 'Inköp av kraftfoder',
): Extract<Handelse, { typ: 'verifikat.bokfort' }> {
  const id = nyttId();
  return {
    ...huvud(),
    typ: 'verifikat.bokfort',
    verifikat: bokfor(
      skapaUtkast({
        id,
        datum: datum(datumtext),
        beskrivning,
        konteringar: [
          { konto: kontonummer('4010'), belopp: oreFromKronor('416.25') },
          { konto: kontonummer('2013'), belopp: oreFromKronor('-416.25') },
        ],
      }),
      {
        serie: verifikatserie(serie),
        nummer,
        bokfortDatum: datum(datumtext),
        kalla: 'manuell',
      },
    ),
  };
}

const UNDERLAG = '019b76da-a800-7000-8000-0000000000f1' as Uuid;

const underlagHandelse = (): Handelse => ({
  ...huvud(),
  typ: 'underlag.tillagt',
  underlag: skapaUnderlag({
    id: UNDERLAG,
    sha256: sha256('c'.repeat(64)),
    mime: 'image/jpeg',
    storlek: 4096,
    filnamn: 'kvitto.jpg',
    tillagd: '2026-09-05T08:00:00.000Z',
  }),
});

const grundlogg = (): Handelse[] => [
  arHandelse(AR_2025, 2025),
  arHandelse(AR_2026, 2026),
  kontoHandelse('4010', 'Inköp material och varor'),
  kontoHandelse('2013', 'Eget uttag/insättningar'),
];

describe('tillampa', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = new KonteraDatabase(uniqueName());
    await db.open();
  });

  it('opens at the latest schema version with the bookkeeping tables', async () => {
    // Not a pinned number: every migration would otherwise break this test
    // for saying nothing about what it is meant to prove.
    expect(db.verno).toBe(latestSchemaVersion());
    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'anlaggning',
      'djurlager',
      'fastighet',
      'fil',
      'handelse',
      'konteringsmall',
      'konto',
      'meta',
      'projekt',
      'rakenskapsar',
      'synkko',
      'underlag',
      'utkast',
      'verifikat',
    ]);
  });

  it('stores the log and the rows it implies', async () => {
    await tillampaAlla(db, grundlogg());
    await tillampa(db, verifikatHandelse('A', 1, '2026-01-09'));

    expect(await lasLogg(db)).toHaveLength(5);
    const tillstand = await lasTillstand(db);
    expect(tillstand.konton.size).toBe(2);
    expect(tillstand.rakenskapsar.size).toBe(2);
    expect(tillstand.verifikat.size).toBe(1);
  });

  it('ignores an entry it has already applied, as a sync will resend', async () => {
    const logg = grundlogg();
    expect(await tillampaAlla(db, logg)).toBe(4);
    expect(await tillampaAlla(db, logg)).toBe(0);
    expect(await lasLogg(db)).toHaveLength(4);
  });

  /*
   * The invariant the whole design rests on. The tables are a view of the
   * log, so reading them must give exactly what folding the log gives. If
   * these ever disagree, one of them is lying and there is no way to tell
   * which from the outside.
   */
  it('leaves the tables identical to the log folded in memory', async () => {
    // Minted after the base log, because an entry's id is its place in the
    // log and a verifikat cannot arrive before the year it belongs to.
    const grund = grundlogg();
    const forstaVerifikatet = verifikatHandelse('A', 1, '2026-01-09');
    const logg = [
      ...grund,
      forstaVerifikatet,
      verifikatHandelse('A', 2, '2026-02-13'),
      verifikatHandelse('B', 1, '2026-03-01'),
      verifikatHandelse('A', 1, '2025-05-06'),
      {
        ...huvud(),
        typ: 'rakenskapsar.momslast' as const,
        rakenskapsarId: AR_2026,
        tom: datum('2026-03-31'),
      },
      underlagHandelse(),
      {
        ...huvud(),
        typ: 'underlag.kopplat' as const,
        underlagId: UNDERLAG,
        verifikatId: forstaVerifikatet.verifikat.id,
      },
    ];

    await tillampaAlla(db, logg);

    const franDatabasen = await lasTillstand(db);
    const franLoggen = bygg(logg);

    expect([...franDatabasen.konton.entries()].sort()).toEqual(
      [...franLoggen.konton.entries()].sort(),
    );
    expect([...franDatabasen.rakenskapsar.entries()].sort()).toEqual(
      [...franLoggen.rakenskapsar.entries()].sort(),
    );
    expect([...franDatabasen.verifikat.entries()].sort()).toEqual(
      [...franLoggen.verifikat.entries()].sort(),
    );
    expect([...franDatabasen.underlag.entries()].sort()).toEqual(
      [...franLoggen.underlag.entries()].sort(),
    );
  });

  it('rebuilds the same books from the log it stored', async () => {
    const logg = [...grundlogg(), verifikatHandelse('A', 1, '2026-01-09')];
    await tillampaAlla(db, logg);

    const utlast = await lasLogg(db);
    const ny = new KonteraDatabase(uniqueName());
    await ny.open();
    await tillampaAlla(ny, utlast);

    expect(await lasTillstand(ny)).toEqual(await lasTillstand(db));
    ny.close();
  });

  /*
   * Hard rule 6 at the storage layer. Series A restarts at 1 every year, so
   * the constraint has to be scoped by räkenskapsår - the books being
   * imported contain A1 four times over.
   */
  it('allows the same number in the same series in different years', async () => {
    await tillampaAlla(db, grundlogg());
    await tillampa(db, verifikatHandelse('A', 1, '2026-01-09'));
    await tillampa(db, verifikatHandelse('A', 1, '2025-05-06'));

    expect((await lasTillstand(db)).verifikat.size).toBe(2);
  });

  it('refuses the same number twice in one series and year', async () => {
    await tillampaAlla(db, grundlogg());
    await tillampa(db, verifikatHandelse('A', 1, '2026-01-09'));

    await expect(tillampa(db, verifikatHandelse('A', 1, '2026-02-13'))).rejects.toThrow();
    expect((await lasTillstand(db)).verifikat.size).toBe(1);
  });

  it('refuses a verifikat dated outside every fiscal year', async () => {
    await tillampaAlla(db, grundlogg());
    await expect(tillampa(db, verifikatHandelse('A', 1, '2024-01-09'))).rejects.toThrow(
      OkantRakenskapsarError,
    );
  });

  it('leaves nothing behind when an entry fails halfway', async () => {
    await tillampaAlla(db, grundlogg());
    const fore = await lasLogg(db);

    await expect(tillampa(db, verifikatHandelse('A', 1, '2024-01-09'))).rejects.toThrow();

    // Neither the log entry nor a partial row may survive the rollback.
    expect(await lasLogg(db)).toHaveLength(fore.length);
    expect(await db.table(VERIFIKAT_TABLE).count()).toBe(0);
  });

  /*
   * What this proves is narrower than it looks: tillampaAlla sorts into log
   * order before applying, so a shuffled batch lands identically. It does not
   * prove that a single out-of-order entry works, and that is not a gap in
   * the test but a property of the design - locking a fiscal year the
   * database has not seen created has no meaning, and the domain refuses it.
   * A sync that receives an entry whose predecessor has not arrived has to
   * wait for it rather than apply it, which is a question for stage 5.
   */
  it('lands a shuffled batch exactly as an ordered one', async () => {
    const logg = [...grundlogg(), verifikatHandelse('A', 1, '2026-01-09')];
    const forvantat = bygg(logg);

    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray(logg, { minLength: logg.length }),
        async (blandad) => {
          const enDb = new KonteraDatabase(uniqueName());
          await enDb.open();
          await tillampaAlla(enDb, blandad);
          const tillstand = await lasTillstand(enDb);
          expect([...tillstand.konton.keys()].sort()).toEqual(
            [...forvantat.konton.keys()].sort(),
          );
          expect(tillstand.verifikat.size).toBe(forvantat.verifikat.size);
          enDb.close();
        },
      ),
      { numRuns: 15 },
    );
  });
});

describe('skyddaBokfordaVerifikat', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = new KonteraDatabase(uniqueName());
    skyddaBokfordaVerifikat(db);
    await db.open();
    await tillampaAlla(db, grundlogg());
    await tillampa(db, verifikatHandelse('A', 1, '2026-01-09'));
  });

  /*
   * The other half of hard rule 5. Freezing the object stops the code holding
   * it; this stops every other route to the same row, including code written
   * later that has forgotten the rule.
   */
  it('refuses an update straight to the table', async () => {
    const tabell = db.table<VerifikatRad, Uuid>(VERIFIKAT_TABLE);
    const rad = (await tabell.toArray())[0];
    expect(rad).toBeDefined();

    await expect(tabell.update(rad!.id, { nummer: 99 })).rejects.toThrow(
      OforanderligtVerifikatError,
    );
    await expect(tabell.put({ ...rad!, nummer: 99 })).rejects.toThrow(
      OforanderligtVerifikatError,
    );
  });

  it('refuses a delete', async () => {
    const tabell = db.table<VerifikatRad, Uuid>(VERIFIKAT_TABLE);
    const rad = (await tabell.toArray())[0];

    await expect(tabell.delete(rad!.id)).rejects.toThrow(OforanderligtVerifikatError);
    await expect(tabell.clear()).rejects.toThrow(OforanderligtVerifikatError);
  });

  it('leaves the verifikat exactly as booked after every attempt', async () => {
    const tabell = db.table<VerifikatRad, Uuid>(VERIFIKAT_TABLE);
    const fore = await tabell.toArray();

    await tabell.update(fore[0]!.id, { nummer: 99 }).catch(() => undefined);
    await tabell.delete(fore[0]!.id).catch(() => undefined);

    expect(await tabell.toArray()).toEqual(fore);
  });

  it('still allows booking new verifikat', async () => {
    await tillampa(db, verifikatHandelse('A', 2, '2026-02-13'));
    expect((await lasTillstand(db)).verifikat.size).toBe(2);
  });

  it('leaves drafts editable', async () => {
    const utkastId = nyttId();
    await tillampa(db, {
      ...huvud(),
      typ: 'utkast.sparat',
      utkast: skapaUtkast({
        id: utkastId,
        datum: datum('2026-04-01'),
        beskrivning: 'Utkast',
        konteringar: [
          { konto: kontonummer('4010'), belopp: oreFromKronor('100.00') },
          { konto: kontonummer('2013'), belopp: oreFromKronor('-100.00') },
        ],
      }),
    });
    await tillampa(db, { ...huvud(), typ: 'utkast.borttaget', utkastId });

    expect((await lasTillstand(db)).utkast.size).toBe(0);
  });
});

describe('senastBokfort', () => {
  let db: KonteraDatabase;

  beforeEach(async () => {
    db = new KonteraDatabase(uniqueName());
    await db.open();
    await tillampaAlla(db, grundlogg());
  });

  /*
   * The case that was wrong: a series imported or booked earlier sorts first
   * by name, so the verifikationslista's order put its highest number at the
   * top, ahead of what this device had just booked in its own series.
   */
  it('picks the last one booked, whichever series sorts first', async () => {
    await tillampa(db, verifikatHandelse('A', 50, '2026-03-01'));
    await tillampa(db, verifikatHandelse('ACHR', 1, '2026-09-01'));
    await tillampa(db, verifikatHandelse('ACHR', 2, '2026-08-15'));

    const senaste = await senastBokfort(db, await lasVerifikat(db, AR_2026));
    expect(senaste?.verifikat.serie).toBe('ACHR');
    expect(senaste?.verifikat.nummer).toBe(2);
  });

  it('goes by when it was booked, not the order a sync delivered it', async () => {
    const forst = verifikatHandelse('ACHR', 1, '2026-09-01');
    const sedan = verifikatHandelse('B', 1, '2026-09-01');
    await tillampa(db, sedan);
    await tillampa(db, forst);

    const senaste = await senastBokfort(db, await lasVerifikat(db, AR_2026));
    expect(senaste?.verifikat.id).toBe(sedan.verifikat.id);
  });

  it('only considers the verifikat it is given', async () => {
    const iAr = verifikatHandelse('A', 1, '2026-02-01');
    await tillampa(db, iAr);
    await tillampa(db, verifikatHandelse('A', 1, '2025-12-30'));

    const senaste = await senastBokfort(db, await lasVerifikat(db, AR_2026));
    expect(senaste?.verifikat.id).toBe(iAr.verifikat.id);
  });

  it('finds nothing when nothing is booked', async () => {
    expect(await senastBokfort(db, [])).toBeUndefined();
  });

  /* The overview shows a few, latest first, by the same rule. */
  it('lists the last few booked, the latest first', async () => {
    const forsta = verifikatHandelse('A', 50, '2026-03-01');
    const andra = verifikatHandelse('ACHR', 1, '2026-09-01');
    const tredje = verifikatHandelse('ACHR', 2, '2026-08-15');
    for (const handelse of [forsta, andra, tredje]) {
      await tillampa(db, handelse);
    }

    const senaste = await senastBokforda(db, await lasVerifikat(db, AR_2026), 2);
    expect(senaste.map((post) => post.verifikat.id)).toEqual([
      tredje.verifikat.id,
      andra.verifikat.id,
    ]);
  });
});
