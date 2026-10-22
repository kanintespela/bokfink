import { expect, test, type Page } from '@playwright/test';

/*
 * The bokslut and the last momsdeklaration of a year happen after it has
 * ended - the fourth quarter is due in February - while the app has moved on
 * to a new, empty year. These tests book in December and then step the
 * clock into January, which is when that work is actually done.
 */

async function bokforForsaljningIDecember(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-12-20T10:00:00+01:00') });
  await page.clock.resume();
  await page.goto('/#bokfor');
  await page.getByLabel('Sök').fill('lamm');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Försäljning av djur/ })
    .click();
  await page.getByLabel('Att få in').fill('12500');
  await page.getByLabel('Datum').fill('2026-12-15');
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await page.clock.setSystemTime(new Date('2027-01-20T10:00:00+01:00'));
  await page.reload();
}

test('declares last year’s fourth quarter after new year', async ({ page }) => {
  await bokforForsaljningIDecember(page);

  await page.goto('/#moms');
  // Opens on the year that still has a declaration waiting, not the new one.
  await expect(page.getByLabel('Räkenskapsår').locator('option:checked')).toHaveText(
    '2026',
  );
  await page.getByLabel('Period', { exact: true }).selectOption({ label: '2026 kv 4' });
  await expect(page.getByTestId('momsrutor')).toContainText('10 000,00');

  await page.getByTestId('las-period').click();
  await expect(page.getByTestId('redan-last')).toContainText('2026-12-31');
});

test('exports last year as SIE once the new year exists', async ({ page }) => {
  await bokforForsaljningIDecember(page);

  await page.goto('/#filer');
  await page.getByLabel('Räkenskapsår att exportera').selectOption({ label: '2026' });
  const nedladdning = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportera 2026 som SIE' }).click();
  expect((await nedladdning).suggestedFilename()).toBe('kontera-2026.se');
});

/*
 * Mistakes from December are found in January, while the year is still
 * open. The list has to show them there, and reversing one has to land in
 * the year it belongs to.
 */
test('shows and reverses last year’s verifikat in January', async ({ page }) => {
  await bokforForsaljningIDecember(page);

  await page.goto('/#verifikat');
  const lista = page.getByTestId('verifikatlista');
  await expect(lista).toContainText('2026-12-15');

  await lista.getByRole('button', { name: /A1/ }).click();
  await page.getByTestId(/^andra-/).click();
  await page.getByTestId(/^annullera-/).click();

  await expect(lista).toContainText('A2');
  await expect(lista).toContainText('annullering');
  await expect(lista).not.toContainText('2027-');
});

/*
 * The order a year actually closes in: the fourth quarter is filed and
 * locked in February, and the bokslut entries dated 31 December come after.
 * The lock keeps the declaration true; it must not stop the bokslut.
 */
test('books a year-end item after the fourth quarter is locked', async ({ page }) => {
  await bokforForsaljningIDecember(page);

  await page.goto('/#moms');
  await page.getByLabel('Period', { exact: true }).selectOption({ label: '2026 kv 4' });
  await page.getByTestId('las-period').click();
  await expect(page.getByTestId('redan-last')).toContainText('2026-12-31');

  // A förskott reaches no box, so the locked declaration lets it through.
  await page.goto('/#periodisering');
  await page
    .getByLabel('Vad gäller det?')
    .selectOption({ label: 'Förskott till leverantör' });
  await page.getByLabel('Beskrivning').fill('Handpenning, ny ladugårdsport');
  await page.getByLabel('Belopp utan moms').fill('8000');
  await page.getByTestId('bokfor-bokslutspost').click();
  await expect(page.getByTestId('bokslutspost-besked')).toContainText('2026-12-31');
});

/*
 * The quarter's moms moves to 2650 once it is declared, and the declaration
 * on screen stays exactly as it was: the settlement records no sale or
 * purchase of its own.
 */
test('books the momsredovisning for a quarter and keeps its boxes', async ({ page }) => {
  await bokforForsaljningIDecember(page);

  await page.goto('/#moms');
  await page.getByLabel('Period', { exact: true }).selectOption({ label: '2026 kv 4' });
  await expect(page.getByTestId('momssumma')).toContainText('2 500,00');

  await page.getByTestId('bokfor-momsredovisning').click();
  await expect(page.getByTestId('moms-besked')).toContainText('bokfördes som A2');
  await expect(page.getByTestId('momsredovisning-bokford')).toContainText('A2');
  await expect(page.getByTestId('momssumma')).toContainText('2 500,00');

  await page.goto('/#verifikat');
  await page.getByTestId('verifikatlista').getByRole('button', { name: /A2/ }).click();
  await expect(page.getByTestId(/^kontering-/)).toContainText('2650');
});

/*
 * The item a business on the kontantmetod most often has: an invoice sent in
 * December and paid in January. Taken up on 31 December with its moms in
 * the fourth quarter, reversed on 1 January.
 */
test('takes up an unpaid invoice at year end and reverses it on 1 January', async ({
  page,
}) => {
  await bokforForsaljningIDecember(page);

  await page.goto('/#periodisering');
  await expect(page.getByTestId('bokslutspost-forklaring')).toContainText(
    'inte fått betalt',
  );
  await page.getByLabel('Beskrivning').fill('Faktura 1042, Hansson');
  await page.getByLabel('Belopp med moms').fill('5000');
  await expect(page.getByTestId('bokslutspost-forslag')).toContainText('1500');
  await page.getByTestId('bokfor-bokslutspost').click();
  // Numbered in each year's own series: A2 in 2026, A1 in 2027.
  await expect(page.getByTestId('bokslutspost-besked')).toContainText(
    'Bokfört som A2 den 2026-12-31 och tillbakafört som A1 den 2027-01-01',
  );

  // 2 500 kr from the December sale and 1 000 kr from the unpaid invoice.
  await page.goto('/#moms');
  await page.getByLabel('Räkenskapsår').selectOption({ label: '2026' });
  await page.getByLabel('Period', { exact: true }).selectOption({ label: '2026 kv 4' });
  await expect(page.getByTestId('momssumma')).toContainText('3 500,00');
});

test('refuses a förskott of 5 000 kr, which K1 does not take up', async ({ page }) => {
  await bokforForsaljningIDecember(page);

  await page.goto('/#periodisering');
  await page
    .getByLabel('Vad gäller det?')
    .selectOption({ label: 'Förskott till leverantör' });
  await page.getByLabel('Beskrivning').fill('Handpenning');
  await page.getByLabel('Belopp utan moms').fill('5000');

  await expect(page.getByTestId('bokslutspost-hinder')).toContainText(
    'överstiger 5 000 kr',
  );
  await expect(page.getByTestId('bokfor-bokslutspost')).toBeDisabled();
});
