/* global migrate, Collection -- provided by PocketBase when it runs the file */
/*
 * The two collections the app syncs through, and the login it uses.
 *
 * Run by PocketBase itself the first time it starts with this directory
 * beside its data, so a new server needs no setup script for its schema.
 * Each collection is created only if it is missing: a server set up by hand
 * before this file existed already has them, and is left as it is.
 *
 * The unique indexes are the protocol, not an optimisation. op_id makes a
 * resent entry a no-op and sha256 does the same for a file, which is what
 * lets a half-finished round simply be run again.
 */
const INLOGGAD = '@request.auth.id != ""';

/** Larger than any entry the app writes; see the second migration. */
const PAYLOAD_MAX = 10485760;

function finns(app, namn) {
  try {
    app.findCollectionByNameOrId(namn);
    return true;
  } catch {
    return false;
  }
}

migrate(
  (app) => {
    if (!finns(app, 'handelser')) {
      app.save(
        new Collection({
          name: 'handelser',
          type: 'base',
          fields: [
            { name: 'op_id', type: 'text', required: true, max: 36 },
            { name: 'device', type: 'text', required: true, max: 64 },
            { name: 'payload', type: 'text', required: true, max: PAYLOAD_MAX },
            { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          ],
          indexes: ['CREATE UNIQUE INDEX idx_op_id ON handelser (op_id)'],
          listRule: INLOGGAD,
          viewRule: INLOGGAD,
          createRule: INLOGGAD,
          updateRule: null,
          deleteRule: null,
        }),
      );
    }

    if (!finns(app, 'filer')) {
      app.save(
        new Collection({
          name: 'filer',
          type: 'base',
          fields: [
            { name: 'sha256', type: 'text', required: true, min: 64, max: 64 },
            {
              name: 'data',
              type: 'file',
              required: true,
              maxSize: 10485760,
              maxSelect: 1,
            },
            { name: 'created', type: 'autodate', onCreate: true, onUpdate: false },
          ],
          indexes: ['CREATE UNIQUE INDEX idx_sha256 ON filer (sha256)'],
          listRule: INLOGGAD,
          viewRule: INLOGGAD,
          createRule: INLOGGAD,
          updateRule: null,
          deleteRule: null,
        }),
      );
    }

    // PocketBase's default is a week. The app renews the login on every
    // sync, so this is how long a device may lie unused before it has to
    // log in again.
    const users = app.findCollectionByNameOrId('users');
    users.authToken.duration = 2592000;
    app.save(users);
  },
  () => {
    // Nothing is undone. Dropping the collections would drop the books'
    // only shared copy, and that is not something a migration should do.
  },
);
