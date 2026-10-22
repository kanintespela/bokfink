import { expect, test } from '@playwright/test';

/*
 * The file cannot be written without an organisationsnummer. Pressing the
 * button without one used to do nothing at all - the error went to the
 * console - so the momsdeklaration simply never appeared.
 */
test('says why the eSKD file cannot be made without an organisationsnummer', async ({
  page,
}) => {
  await page.goto('/#moms');
  await page.getByTestId('exportera-eskd').click();

  await expect(page.getByTestId('moms-fel')).toContainText('Organisationsnumret');
});

test('makes the eSKD file from a personnummer written with its century', async ({
  page,
}) => {
  await page.goto('/#foretag');
  await page.getByLabel('Organisationsnummer').fill('19121212-1212');

  await page.goto('/#moms');
  const nedladdning = page.waitForEvent('download');
  await page.getByTestId('exportera-eskd').click();
  expect((await nedladdning).suggestedFilename()).toMatch(/^eSKD_Moms_/);
  await expect(page.getByTestId('moms-fel')).toBeHidden();
});
