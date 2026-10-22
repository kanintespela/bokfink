import { expect, test } from '@playwright/test';

/*
 * The year-end count, booked: twenty ewes counted on the balansdag at 85 %
 * of a production cost of 1 000 kr is 17 000 kr, which moves onto 1400
 * against 4900 and shows up as B6 Varulager in the årsbokslut.
 */
test('books the year-end count onto the stock account', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-12-31T15:00:00+01:00') });
  await page.clock.resume();

  await page.goto('/#lager');
  await page.getByLabel('Datum').fill('2026-12-31');
  await page.getByLabel('Djurslag').fill('Tacka');
  await page.getByLabel('Antal').fill('20');
  await page.getByLabel('Genomsnittlig produktionsutgift per djur').fill('1000');
  await page.getByLabel('Nettoförsäljningsvärde per djur').fill('2000');
  await page.getByTestId('lagg-till-djurpost').click();
  await page.getByTestId('registrera-inventering').click();
  await expect(page.getByTestId('lager-besked')).toContainText('registrerad');

  await page.getByTestId('bokfor-lager-2026-12-31').click();
  await expect(page.getByTestId('lager-besked')).toContainText('bokfördes som A1');

  // A second press finds nothing left to book, and says so.
  await page.getByTestId('bokfor-lager-2026-12-31').click();
  await expect(page.getByTestId('lager-fel')).toContainText('redan');

  await page.goto('/#arsbokslut');
  await expect(page.getByTestId('ruta-B6')).toContainText('17 000,00');
});
