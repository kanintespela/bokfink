import { expect, test } from '@playwright/test';

/*
 * Registering, selling and computing a year's depreciation, driven the way
 * the screen is actually used. The pool arithmetic itself - huvudregeln,
 * kompletteringsregeln, the direktavdrag threshold - already has its own
 * hand-verified tests against BFN's own examples; this is about the UI
 * wiring: does a tap here end up as the right call underneath.
 */
test('registers an anläggningstillgång and marks it avyttrad', async ({ page }) => {
  await page.goto('/#anlaggning');

  await page.getByLabel('Tillgångens benämning').fill('Betgrep');
  await page.getByLabel('Tillgångens anskaffningsvärde').fill('50000');
  await page.getByLabel('Uppskattad nyttjandeperiod, år').fill('10');

  // Well above the direktavdrag threshold, so no hint should show.
  await expect(page.getByTestId('direktavdrag-varning')).toHaveCount(0);

  await page.getByTestId('registrera-anlaggning').click();
  await expect(page.getByTestId('anlaggning-besked')).toContainText('registrerad');
  await expect(page.getByTestId('anlaggningslista')).toContainText('Betgrep');

  await page.getByTestId('anlaggningslista').getByRole('button').first().click();
  await page.getByRole('button', { name: 'Sålt' }).click();
  await page.getByLabel('Försäljningsinkomst').fill('37000');
  await page.getByTestId(/^bekrafta-avyttring-/).click();

  await expect(page.getByTestId('anlaggning-besked')).toContainText(
    'Försäljningen registrerad',
  );
  await expect(page.getByTestId('anlaggningslista')).toContainText('Såld');
});

test('warns before registering something that qualifies for direktavdrag', async ({
  page,
}) => {
  await page.goto('/#anlaggning');

  await page.getByLabel('Tillgångens benämning').fill('Skruvdragare');
  await page.getByLabel('Tillgångens anskaffningsvärde').fill('2000');
  await page.getByLabel('Uppskattad nyttjandeperiod, år').fill('10');

  await expect(page.getByTestId('direktavdrag-varning')).toContainText(
    'kostnadsföras direkt',
  );
});

// A new ledger has BAS K1's 1220-1229 already, with nothing on them.
test('says there is nothing to depreciate when the pool is empty', async ({ page }) => {
  await page.goto('/#anlaggning');
  await page.getByTestId('berakna-avskrivning').click();

  await expect(page.getByTestId('avskrivningsforslag')).toContainText(
    'Underlaget är noll',
  );
  await expect(page.getByTestId('bokfor-huvudregeln')).toBeDisabled();
});
