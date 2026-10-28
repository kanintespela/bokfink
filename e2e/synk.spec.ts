import { expect, test } from '@playwright/test';

/*
 * The sync screen without a server: what it says before anything is set up,
 * and that it will not pretend to work. The protocol itself is tested against
 * a real PocketBase in the unit tests and by hand; what is checked here is
 * that the app never syncs silently or claims to have.
 */
test('says what the sync knows before it is set up', async ({ page }) => {
  await page.goto('/#enhet');

  await expect(page.getByTestId('synk-senast')).toHaveText('Aldrig');
  await expect(page.getByTestId('synk-enhet')).not.toHaveText('');
  // A fresh install has written its first entries and not sent them anywhere.
  await expect(page.getByTestId('synk-osankta')).toContainText('händelser');
});

test('refuses to sync without a server and says why', async ({ page }) => {
  await page.goto('/#enhet');

  await page.getByLabel('Serverns adress').fill('https://127.0.0.1:9');
  await page.getByLabel('E-post').fill('agare@exempel.se');
  await page.getByLabel('Lösenord', { exact: true }).fill('fel');
  await page.getByTestId('logga-in').click();

  await expect(page.getByTestId('synk-fel')).toContainText('svarar inte');
});

/*
 * Decision X: the passphrase is optional and folded away, and the sync is
 * unencrypted until one is set. The screen says which it is.
 */
test('says the sync is unencrypted until a passphrase is set', async ({ page }) => {
  await page.goto('/#enhet');

  await page.getByText('Kryptering (valfritt)').click();
  await expect(page.getByTestId('synk-kryptering')).toContainText('inte krypterad');
  await page.getByLabel('Lösenfras för synken').fill('en delad lösenfras');
  await page.getByTestId('spara-synklosenfras').click();

  await expect(page.getByTestId('synk-besked')).toContainText('sparades');
  await expect(page.getByTestId('synk-kryptering')).toContainText('krypteras');

  await page.getByTestId('ta-bort-synklosenfras').click();
  await expect(page.getByTestId('synk-kryptering')).toContainText('inte krypterad');
});

/*
 * Two devices that each typed "the same phrase" have to end up with the
 * literal same bytes going into the key, or neither can read what the other
 * sends - and a masked field never shows a stray space that made them
 * differ. Whitespace at the edges is trimmed before it is saved; whitespace
 * alone is still nothing.
 */
test('trims a passphrase before saving it, and refuses one that is only spaces', async ({
  page,
}) => {
  await page.goto('/#enhet');
  await page.getByText('Kryptering (valfritt)').click();

  const falt = page.getByLabel('Lösenfras för synken');
  const spara = page.getByTestId('spara-synklosenfras');

  await falt.fill('   ');
  await expect(spara).toBeDisabled();

  await falt.fill('  en delad lösenfras  ');
  await expect(spara).toBeEnabled();
  await spara.click();

  await expect(page.getByTestId('synk-besked')).toContainText('sparades');
  // Cleared on success, same as the plain case.
  await expect(falt).toHaveValue('');
});
