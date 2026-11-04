import { expect, test, type Page } from '@playwright/test';

/*
 * Faktureringsmetoden: an invoice is booked the day it is written, unpaid, and
 * its moms falls in that period; the payment is a second entry that clears it.
 */
async function bokforObetaldForsaljning(page: Page): Promise<void> {
  await page.goto('/#foretag');
  await page.getByLabel('Redovisningsmetod').selectOption('faktureringsmetoden');

  await page.goto('/#bokfor');
  await page.getByLabel('Sök').fill('ull');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Försäljning av varor/ })
    .click();
  await page.getByLabel('Att få in').fill('1250');
  await page.getByLabel('Vad avser det?').fill('Faktura 3001 Ullspinneriet');
  await page.getByLabel('Datum').fill('2026-02-10');
  await page.getByRole('button', { name: 'Obetald faktura' }).click();
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();
}

test('books an unpaid sale, reports its moms at once, and settles it in two payments', async ({
  page,
}) => {
  await bokforObetaldForsaljning(page);

  // The moms is due for the quarter of the invoice although nothing is paid.
  await page.goto('/#moms');
  await page.getByLabel('Period', { exact: true }).selectOption({ label: '2026 kv 1' });
  await expect(page.getByTestId('momsrutor')).toContainText('250,00');

  await page.goto('/#fakturor');
  const faktura = page.getByTestId('kundfakturor');
  await expect(faktura).toContainText('Faktura 3001 Ullspinneriet');
  await expect(faktura).toContainText('1 250,00 kr kvar');

  await page.getByTestId('betala-A1').click();
  await page.getByLabel('Belopp').fill('500');
  await page.getByLabel('Datum').fill('2026-02-20');
  await page.getByTestId('bokfor-betalning').click();
  await expect(page.getByTestId('datautbyte-besked')).toContainText('bokfördes som A2');
  await expect(faktura).toContainText('750,00 kr kvar av 1 250,00 kr');

  await page.getByTestId('betala-A1').click();
  await page.getByLabel('Datum').fill('2026-03-02');
  await page.getByTestId('bokfor-betalning').click();
  await expect(page.getByTestId('inga-fakturor')).toBeVisible();
});

test('refuses a payment larger than what is left', async ({ page }) => {
  await bokforObetaldForsaljning(page);

  await page.goto('/#fakturor');
  await page.getByTestId('betala-A1').click();
  await page.getByLabel('Belopp').fill('1300');
  await page.getByTestId('bokfor-betalning').click();
  await expect(page.getByTestId('datautbyte-fel')).toContainText(
    'större än det som är kvar',
  );
});

test('offers no unpaid invoice with the cash method, and says so on the screen', async ({
  page,
}) => {
  await page.goto('/#bokfor');
  await page.getByLabel('Sök').fill('ull');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Försäljning av varor/ })
    .click();
  await expect(page.getByRole('button', { name: 'Obetald faktura' })).toBeHidden();

  await page.goto('/#fakturor');
  await expect(page.getByTestId('fakturor-kontantmetod')).toBeVisible();
});
