import { expect, test } from '@playwright/test';

test('shows the start page with real database status', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Bokfink', level: 1 })).toBeVisible();

  // The database status lives with the other registers rather than on the
  // start view, which is about what needs doing. Settings is a menu, and the
  // status belongs to this installation.
  await page.getByRole('button', { name: 'Inställningar' }).click();
  await page.getByRole('button', { name: 'Den här enheten' }).click();

  /*
   * Proves the database opened in the browser, not just under Vitest. The
   * version is matched as a shape rather than a number: what matters is that
   * the database reached the latest schema, and pinning the number here just
   * breaks this test every time a migration is added.
   */
  await expect(page.getByTestId('schema-version')).toHaveText(/^(\d+) av \1$/);
  await expect(page.getByTestId('device-id')).not.toBeEmpty();
  await expect(page.getByTestId('status-error')).toHaveCount(0);
});

test('keeps the same device id across reloads', async ({ page }) => {
  await page.goto('/#enhet');
  const first = await page.getByTestId('device-id').textContent();

  await page.reload();
  await expect(page.getByTestId('device-id')).toHaveText(first ?? '');
});

test('opens with no network at all', async ({ page, context }) => {
  await page.goto('/');

  // The page must be *controlled* by the service worker, not merely have one
  // registered: an activated worker that has not claimed the client yet still
  // lets the navigation go to the network, where being offline fails.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 15_000,
  });

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Bokfink', level: 1 })).toBeVisible();
  // The whole app, not just a cached shell: the templates come from the
  // database, which had to open offline for them to be there at all.
  await expect(
    page.locator('main').getByRole('button', { name: 'Bokför', exact: true }),
  ).toBeVisible();
});
