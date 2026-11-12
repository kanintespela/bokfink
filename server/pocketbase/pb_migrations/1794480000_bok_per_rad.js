/* global migrate, Collection, TextField -- provided by PocketBase when it runs the file */
/*
 * Lets one server hold several books, kept apart.
 *
 * Until now a row said nothing about whose books it belonged to, and every
 * device was handed every row. One book per server was the only safe use: a
 * second one syncing against it was folded into the first, for good, since
 * nothing here can be deleted.
 *
 * Every row now names its book, and the server only hands out the rows of
 * the book that is asked for. The asking is part of the rule rather than a
 * filter the app adds, on purpose: an app from before this change asks for
 * no book, and is given nothing - instead of being given every book at once
 * and folding them together on the device. What such an app sends is turned
 * away too, since it names no book, and stays queued on the device until the
 * app has updated itself.
 *
 * The rows already here belong to the first book, whose identity is the same
 * fixed word on every installation (URSPRUNGLIG_BOK in
 * src/data/bokidentitet.ts). That it was the first book that synced against
 * this server was confirmed by the owner on 2026-11-12.
 */
const INLOGGAD = '@request.auth.id != ""';
const BOKENS_RADER = `${INLOGGAD} && bok = @request.query.bok`;
const URSPRUNGLIG_BOK = 'kontera';

/** A UUID is 36 characters; the room above that costs nothing. */
const BOK_MAX = 64;

/** A name, a profile and a handful of settings, possibly encrypted. */
const BESKRIVNING_MAX = 20000;

function finns(app, namn) {
  try {
    app.findCollectionByNameOrId(namn);
    return true;
  } catch {
    return false;
  }
}

function markMedBok(app, namn, index) {
  let samling = app.findCollectionByNameOrId(namn);

  // In two saves: the column has to exist before the old rows can be given
  // their book, and they have to have one before it can be required.
  if (!samling.fields.getByName('bok')) {
    samling.fields.add(new TextField({ name: 'bok', max: BOK_MAX }));
    app.save(samling);
  }
  app
    .db()
    .newQuery(`UPDATE ${namn} SET bok = {:bok} WHERE bok = '' OR bok IS NULL`)
    .bind({ bok: URSPRUNGLIG_BOK })
    .execute();

  samling = app.findCollectionByNameOrId(namn);
  samling.fields.getByName('bok').required = true;
  samling.indexes = index;
  samling.listRule = BOKENS_RADER;
  samling.viewRule = BOKENS_RADER;
  app.save(samling);
}

migrate(
  (app) => {
    /*
     * op_id stays unique across the whole server: it is a UUIDv7 and belongs
     * to one book only. The second index is what makes fetching one book's
     * rows in order cheap when there are several.
     */
    markMedBok(app, 'handelser', [
      'CREATE UNIQUE INDEX idx_op_id ON handelser (op_id)',
      'CREATE INDEX idx_handelser_bok ON handelser (bok, created, id)',
    ]);

    /*
     * A file is unique within its book, not on the server. The same receipt
     * can be evidence in two books, and each may encrypt it with its own
     * passphrase - one shared row would be unreadable to one of them.
     */
    markMedBok(app, 'filer', [
      'CREATE UNIQUE INDEX idx_bok_sha256 ON filer (bok, sha256)',
    ]);

    /*
     * Which books the server holds, and what each one calls itself.
     *
     * A device joining a book needs its name and its kind before it has read
     * a single entry, and neither is in the log: they live in the book's own
     * metadata on each device. The description is written by the app and is
     * opaque here - JSON, or ciphertext when the book has a passphrase.
     */
    if (!finns(app, 'bocker')) {
      app.save(
        new Collection({
          name: 'bocker',
          type: 'base',
          fields: [
            { name: 'bok', type: 'text', required: true, max: BOK_MAX },
            { name: 'beskrivning', type: 'text', required: true, max: BESKRIVNING_MAX },
            { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
            { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
          ],
          indexes: ['CREATE UNIQUE INDEX idx_bocker_bok ON bocker (bok)'],
          listRule: INLOGGAD,
          viewRule: INLOGGAD,
          createRule: INLOGGAD,
          // A book can be renamed, which is the one thing here that changes.
          updateRule: INLOGGAD,
          deleteRule: null,
        }),
      );
    }
  },
  () => {
    // Nothing is undone. Taking the book off the rows would put every book
    // on the server back into one pile, which is what this is here to end.
  },
);
