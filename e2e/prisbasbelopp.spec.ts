import { expect, test } from '@playwright/test';

/*
 * A year the app does not ship with, fetched from SCB with one tap and saved
 * with a second. The network is answered here with SCB's own reply for 2027,
 * so the test never leaves the machine - and fails if anything other than
 * the year is asked for.
 */
test('fetches next year’s prisbasbelopp from SCB and keeps it', async ({ page }) => {
  let fraga = '';
  await page.route('https://api.scb.se/**', async (route) => {
    fraga = route.request().postData() ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ data: [{ key: ['2027'], values: ['59600'] }] }),
    });
  });

  await page.goto('/#anlaggning');
  await page.getByLabel('År', { exact: true }).fill('2027');
  await page.getByTestId('hamta-prisbasbelopp').click();

  await expect(page.getByTestId('pbb-besked')).toContainText('59 600');
  await expect(page.getByLabel('Prisbasbelopp, kronor')).toHaveValue('59600');
  expect(fraga).toContain('"2027"');

  await page.getByTestId('spara-prisbasbelopp').click();
  await expect(page.getByTestId('kanda-prisbasbelopp')).toContainText('inlagt av dig');

  await page.reload();
  await expect(page.getByTestId('kanda-prisbasbelopp')).toContainText('59 600,00');
});

test('says so when SCB cannot be reached', async ({ page }) => {
  await page.route('https://api.scb.se/**', (route) => route.abort());

  await page.goto('/#anlaggning');
  await page.getByLabel('År', { exact: true }).fill('2027');
  await page.getByTestId('hamta-prisbasbelopp').click();

  await expect(page.getByTestId('pbb-fel')).toContainText('SCB svarar inte');
});
