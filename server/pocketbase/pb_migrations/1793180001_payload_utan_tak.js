/* global migrate -- provided by PocketBase when it runs the file */
/*
 * Lifts the size limit on an encrypted entry.
 *
 * The first setup script declared payload with "max": 0, meaning "no
 * limit". PocketBase reads 0 as "the default", which for a text field is
 * 5000 characters - and an entry larger than that was refused with a bare
 * 400, holding up everything queued behind it. Found 2026-10-28, when a
 * phone could no longer send anything.
 *
 * The new limit is the same 10 MB a file may be. It is there to keep a
 * broken client from filling the disk, not to shape what an entry may hold.
 */
migrate(
  (app) => {
    const handelser = app.findCollectionByNameOrId('handelser');
    handelser.fields.getByName('payload').max = 10485760;
    app.save(handelser);
  },
  (app) => {
    const handelser = app.findCollectionByNameOrId('handelser');
    handelser.fields.getByName('payload').max = 0;
    app.save(handelser);
  },
);
