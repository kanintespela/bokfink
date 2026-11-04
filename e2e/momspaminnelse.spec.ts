import { expect, test } from '@playwright/test';

/*
 * The reminder is only worth anything if it goes away the way it says it
 * does: locking the period on the Moms page, which is what is done once the
 * deklaration has been filed.
 */
test('reminds of an undeclared quarter until its period is locked', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-07-20T10:00:00+02:00') });
  await page.clock.resume();

  // A book with nothing in it owes no reminder; this one starts in February.
  await page.goto('/#bokfor');
  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await page.getByLabel('Att betala').fill('100');
  await page.getByLabel('Datum').fill('2026-02-13');
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await page.goto('/#attgora');

  const kort = page.getByTestId('momsdeklaration-vantar');
  await expect(kort).toContainText('2026 kv 1 skulle ha deklarerats');
  await expect(kort).toContainText('2026-05-12');
  await expect(kort).toContainText('En period till väntar');

  await kort.click();
  await page.getByTestId('las-period').click();
  await page.getByTestId('las-period-ja').click();
  await expect(page.getByTestId('las-period')).toBeHidden();

  await page.goto('/');
  await expect(kort).toContainText('2026 kv 2 ska deklareras och betalas senast');
  await expect(kort).toContainText('2026-08-17, om 28 dagar');
  await expect(kort).not.toContainText('väntar');
});

test('does not remind a book that has nothing booked yet', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-07-20T10:00:00+02:00') });
  await page.clock.resume();
  await page.goto('/');

  await expect(page.getByTestId('momsdeklaration-vantar')).toBeHidden();
});
