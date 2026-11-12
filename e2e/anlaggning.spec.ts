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

/*
 * A drilled well, from the receipt to the register: booked by answering what
 * it is, offered to the register straight away, and entered there with what
 * the verifikat already says - so that the name, the date and the cost are
 * typed once. 93 750 kr with 25 % moms is 75 000 kr for the well itself.
 */
test('offers a booked markanläggning to the register, filled in from the verifikat', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Vyer' })
    .getByRole('button', { name: 'Bokför', exact: true })
    .click();
  await page.getByLabel('Sök').fill('brunn');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Markanläggning/ })
    .click();
  await expect(page.getByTestId('valt-lov')).toContainText('1150');
  await page.getByLabel('Att betala').fill('93750');
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toContainText('A1');

  // Said where the booking was made, with what it found.
  const forslag = page.getByTestId('anlaggningsforslag');
  await expect(forslag).toContainText('75 000');
  await expect(forslag).toContainText('markanläggning');

  // And on the first screen, for the day it is not acted on at once.
  await page
    .getByRole('navigation', { name: 'Vyer' })
    .getByRole('button', { name: 'Översikt' })
    .click();
  await expect(page.getByTestId('anlaggningskop-vantar')).toContainText('Ett köp');
  await page.getByTestId('anlaggningskop-vantar').click();

  const kop = page.getByTestId('oregistrerade-kop');
  await expect(kop).toContainText('A1');
  await kop.getByRole('button', { name: /^Lägg in .* i registret$/ }).click();

  // Nothing to type: the form holds what the verifikat says.
  await expect(kop.getByLabel('Anskaffningsvärde, utan moms')).toHaveValue('75000,00');
  await expect(kop.getByLabel('Vad är det?')).toHaveValue('markanlaggning');
  await expect(kop.getByLabel('Markanläggningstyp')).toHaveValue('ovrig');
  await kop.getByLabel('Benämning').fill('Borrad brunn');
  await kop.getByRole('button', { name: 'Spara i registret' }).click();

  // In the register at 5 %, pointing back at what it was bought with.
  const rad = page.getByTestId('fastighetslista');
  await expect(rad).toContainText('Borrad brunn');
  await expect(rad).toContainText('5 %');
  await expect(rad).toContainText('Köpt med A1');

  // And no longer asked about, here or on the first screen.
  await expect(kop.getByRole('button', { name: /i registret$/ })).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Vyer' })
    .getByRole('button', { name: 'Översikt' })
    .click();
  await expect(page.getByTestId('anlaggningskop-vantar')).toHaveCount(0);
});

test('stops asking about a purchase that was not an asset', async ({ page }) => {
  await page.goto('/#frikontering');
  await page.getByLabel('Vad avser det?').fill('Rättelse av konto');
  await page.getByLabel('Konto, rad 1').fill('1221');
  await page.getByLabel('Debet, rad 1').fill('100');
  await page.getByLabel('Konto, rad 2').fill('1930');
  await page.getByLabel('Kredit, rad 2').fill('100');
  await page.getByTestId('bokfor-fri').click();
  await expect(page.getByTestId('fri-besked')).toContainText('A1');
  await expect(page.getByTestId('anlaggningsforslag')).toContainText('Rättelse av konto');

  await page.goto('/#anlaggning');
  await page
    .getByRole('button', { name: 'Rättelse av konto är inte en anläggning' })
    .click();

  await expect(page.getByTestId('oregistrerade-kop')).toContainText('föreslås inte igen');
  await page.goto('/#frikontering');
  await expect(page.getByTestId('anlaggningsforslag')).toHaveCount(0);
});
