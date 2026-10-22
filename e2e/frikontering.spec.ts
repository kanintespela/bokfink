import { expect, test, type Page } from '@playwright/test';

async function rad(
  page: Page,
  nummer: number,
  konto: string,
  sida: 'Debet' | 'Kredit',
  belopp: string,
) {
  if (nummer > 2) {
    await page.getByTestId('lagg-till-rad').click();
  }
  await page.getByLabel(`Konto, rad ${nummer}`).fill(konto);
  await page.getByLabel(`${sida}, rad ${nummer}`).fill(belopp);
}

/*
 * The receipt no single answer can book: feed at 25 % and food at 12 % on one
 * slip, paid privately. 320 + 80 + 200 + 24 = 624.
 */
test('books a receipt with two VAT rates by choosing the accounts', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-04-05T10:00:00+02:00') });
  await page.clock.resume();
  await page.goto('/#bokfor');
  await page.getByTestId('till-fri-kontering').click();

  await page.getByLabel('Vad avser det?').fill('Foder och mat, Lantmännen');
  await rad(page, 1, '4000', 'Debet', '320');
  await rad(page, 2, '2641', 'Debet', '80');
  await rad(page, 3, '4000', 'Debet', '200');
  await rad(page, 4, '2641', 'Debet', '24');
  await rad(page, 5, '2017', 'Kredit', '623');

  // One krona short: said in words, and the button stays off.
  await expect(page.getByTestId('fri-hinder')).toContainText('skiljer 1,00 kr');
  await expect(page.getByTestId('bokfor-fri')).toBeDisabled();

  await page.getByLabel('Kredit, rad 5').fill('624');
  await expect(page.getByTestId('fri-hinder')).toBeHidden();
  await page.getByTestId('bokfor-fri').click();
  await expect(page.getByTestId('fri-besked')).toContainText('A1');

  await page.goto('/#verifikat');
  await page.getByTestId('verifikatlista').getByRole('button', { name: /A1/ }).click();
  await expect(page.getByTestId(/^kontering-/).getByRole('listitem')).toHaveCount(5);
});

test('names an account the kontoplan does not have', async ({ page }) => {
  await page.goto('/#frikontering');
  await page.getByLabel('Vad avser det?').fill('Test');
  await rad(page, 1, '6991', 'Debet', '100');
  await rad(page, 2, '1930', 'Kredit', '100');

  await expect(page.getByTestId('fri-hinder')).toContainText('6991 finns inte');
  await expect(page.getByTestId('bokfor-fri')).toBeDisabled();
});

test('finds an account by what it is called', async ({ page }) => {
  await page.goto('/#frikontering');
  const falt = page.getByLabel('Konto, rad 1');
  // Typed without å, the way a phone keyboard in a hurry types it.
  await falt.fill('ingaende');

  const forslag = page.getByTestId('kontoforslag-0').getByRole('button');
  await expect(forslag.first()).toHaveText('2641 Debiterad ingående moms');

  await forslag.first().click();
  await expect(falt).toHaveValue('2641');
  await expect(page.getByTestId('kontoforslag-0')).toBeHidden();

  await page.getByLabel('Konto, rad 2').fill('ingenting sånt');
  await expect(page.getByTestId('fria-rader')).toContainText(
    'Inget konto matchar ”ingenting sånt”.',
  );
});
