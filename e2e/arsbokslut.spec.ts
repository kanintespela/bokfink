import { expect, test, type Page } from '@playwright/test';

/** One sale and one purchase through the company account. */
async function bokforNagot(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('main').getByRole('button', { name: 'Bokför' }).click();

  await page.getByLabel('Sök').fill('lamm');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Försäljning av djur/ })
    .click();
  await page.getByLabel('Att få in').fill('12500');
  await page.getByRole('button', { name: 'Företagskontot' }).click();
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await page.getByLabel('Att betala').fill('6250');
  await page.getByRole('button', { name: 'Företagskontot' }).click();
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();
}

/*
 * The form, worked out by hand. A sale of 12 500 including 2 500 moms and a
 * purchase of 6 250 including 1 250 moms, both through 1930:
 *
 *   B9  Kassa och bank   12 500 - 6 250      = 6 250
 *   B14 Skatteskulder     2 500 - 1 250      = 1 250
 *   B10 Eget kapital     no IB, result 5 000 = 5 000
 *   R1  10 000, R5 5 000, R11 5 000
 */
test('sorts the year into the boxes of the förenklat årsbokslut', async ({ page }) => {
  await bokforNagot(page);

  await page.goto('/#attgora');
  await page.getByRole('button', { name: 'Förenklat årsbokslut' }).click();

  await expect(page.getByTestId('ruta-B9')).toContainText('6 250,00');
  await expect(page.getByTestId('ruta-B14')).toContainText('1 250,00');
  await expect(page.getByTestId('ruta-B10')).toContainText('5 000,00');
  await expect(page.getByTestId('ruta-R1')).toContainText('10 000,00');
  await expect(page.getByTestId('ruta-R5')).toContainText('5 000,00');
  await expect(page.getByTestId('summa-R11 Bokfört resultat')).toContainText('5 000,00');
  await expect(page.getByTestId('summa-Summa tillgångar')).toContainText('6 250,00');
  await expect(page.getByTestId('summa-Summa eget kapital och skulder')).toContainText(
    '6 250,00',
  );
  await expect(page.getByTestId('arsbokslut-differens')).toBeHidden();
  await expect(page.getByTestId('konton-utan-ruta')).toBeHidden();

  // B10 opens to show that the result has not been booked over yet.
  await page.getByTestId('ruta-B10').getByRole('button').click();
  await expect(page.getByTestId('ruta-B10')).toContainText(
    'ännu inte fört till eget kapital',
  );
});

/*
 * A choice between two boxes is about the business, not the visit, so it has
 * to survive a reload. The eget kapital screen is used only because it books
 * against any account number, which is the shortest way to get a balance on
 * 3740 öresutjämning.
 */
test('remembers which box an öresutjämning goes to', async ({ page }) => {
  await page.goto('/#egetkapital');
  await page.getByLabel('Belopp').fill('0,40');
  await page.getByLabel('Konto pengarna tas från').fill('3740');
  await page.getByTestId('bokfor-egetkapital').click();
  await expect(page.getByTestId('egetkapital-besked')).toContainText('bokfört');

  await page.goto('/#attgora');
  await page.getByRole('button', { name: 'Förenklat årsbokslut' }).click();
  await expect(page.getByTestId('arsbokslut-resultatdifferens')).toBeVisible();
  await page.getByTestId('valj-ruta-3740').getByRole('button', { name: /R1/ }).click();

  await expect(page.getByTestId('valt-3740')).toContainText('R1');
  await expect(page.getByTestId('ruta-R1')).toContainText('0,40');
  await expect(page.getByTestId('arsbokslut-resultatdifferens')).toBeHidden();

  await page.reload();
  await expect(page.getByTestId('valt-3740')).toContainText('R1');
  await expect(page.getByTestId('valj-ruta-3740')).toBeHidden();
});

/*
 * The NE-bilaga from the same year: page 1 is the årsbokslut in whole
 * kronor, page 2 takes last year's underskott, and what is entered survives
 * a reload. The file for 2026 is refused until Skatteverket has published
 * that year's field codes - the file itself is covered by golden files.
 *
 * Result 5 000, underskott brought forward 8 000: R48 3 000.
 */
test('works out the NE-bilaga and keeps what was entered', async ({ page }) => {
  await bokforNagot(page);

  await page.goto('/#attgora');
  await page.getByRole('button', { name: 'NE-bilaga' }).click();

  await expect(page.getByTestId('ne-R11')).toContainText('5 000,00');
  await expect(page.getByTestId('ne-B10')).toContainText('5 000,00');
  await expect(page.getByTestId('ne-hinder')).toBeHidden();

  await page.getByLabel(/^R24 /).fill('8000');
  await expect(page.getByTestId('ne-R48')).toContainText('3 000,00');

  await page.getByLabel('Personnummer, tolv siffror').fill('191212121212');
  await page.getByLabel('Namn').fill('Test Testsson');
  await page.getByLabel('Postnummer').fill('36430');
  await page.getByLabel('Postort').fill('Åseda');
  await page.getByTestId('ne-spara').click();
  await expect(page.getByTestId('ne-besked')).toContainText('sparade');

  await page.reload();
  await expect(page.getByLabel(/^R24 /)).toHaveValue('8000');
  await expect(page.getByLabel('Postort')).toHaveValue('Åseda');

  await page.getByTestId('ne-BLANKETTER.SRU').click();
  await expect(page.getByTestId('ne-fel')).toContainText('2026P4');
});

/*
 * A debit balance on 2650 is money Skatteverket owes, and belongs on 1650
 * among the assets - otherwise it turns up as a negative B14. The eget
 * kapital screen is used to get the balance there in the first place.
 */
test('offers to move a momsfordran off the skuldkontot', async ({ page }) => {
  // The move is booked on the year's last day, which cannot be in the future.
  await page.clock.install({ time: new Date('2026-12-31T12:00:00+01:00') });
  await page.clock.resume();
  await page.goto('/#egetkapital');
  await page.getByRole('button', { name: 'Egen insättning' }).click();
  await page.getByLabel('Belopp').fill('1875');
  await page.getByLabel('Konto pengarna sätts in på').fill('2650');
  await page.getByTestId('bokfor-egetkapital').click();
  await expect(page.getByTestId('egetkapital-besked')).toContainText('bokfört');

  await page.goto('/#arsbokslut');
  await expect(page.getByTestId('ruta-B14')).toContainText('-1 875,00');
  await expect(page.getByTestId('momsomforing')).toContainText('1 875,00');

  await page.getByTestId('bokfor-momsomforing').click();
  await expect(page.getByTestId('arsbokslut-besked')).toContainText('bokfört');

  await expect(page.getByTestId('momsomforing')).toBeHidden();
  await expect(page.getByTestId('ruta-B8')).toContainText('1 875,00');
  await expect(page.getByTestId('ruta-B14')).toContainText('0,00');
  await expect(page.getByTestId('arsbokslut-differens')).toBeHidden();
});

/*
 * An underskott is carried to R24 the following year, and nobody should have
 * to look it up. A purchase of 6 250 including moms and no income is a loss
 * of 5 000; next year's bilaga offers exactly that.
 */
test('suggests the previous year underskott as R24', async ({ page }) => {
  await page.goto('/');
  await page.locator('main').getByRole('button', { name: 'Bokför' }).click();
  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await page.getByLabel('Att betala').fill('6250');
  await page.getByRole('button', { name: 'Företagskontot' }).click();
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await page.goto('/#rakenskapsar');
  await page
    .getByTestId('rakenskapsarlista')
    .getByRole('button', { name: /2026/ })
    .click();
  await page.getByTestId('skapa-nasta-ar-2026').click();
  await page.getByTestId('for-over-balanser-2026').click();
  await expect(page.getByTestId('overforda-balanser-2026')).toBeVisible();

  await page.goto('/#nebilaga');
  await page.getByLabel('Räkenskapsår').selectOption({ label: '2027' });
  await expect(page.getByTestId('forslag-r24')).toContainText('5 000,00');

  await page.getByRole('button', { name: 'Använd det' }).click();
  await expect(page.getByLabel(/^R24 /)).toHaveValue('5000');
  await expect(page.getByTestId('ne-R48')).toContainText('5 000,00');
});
