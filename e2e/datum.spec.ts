import { expect, test } from '@playwright/test';

/*
 * A booking records something that has happened. A date in the future is a
 * slip far more often than a plan, and it would land in a period nobody is
 * looking at - so it is refused, with the reason.
 */
test('refuses to book a date after today', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-04-05T10:00:00+02:00') });
  await page.clock.resume();

  await page.goto('/#bokfor');
  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await page.getByLabel('Att betala').fill('100');
  await page.getByLabel('Datum').fill('2026-12-24');
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();

  await expect(page.getByTestId('bokfor-fel')).toContainText('har inte hänt än');

  await page.getByLabel('Datum').fill('2026-04-05');
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toContainText('A1');
});
