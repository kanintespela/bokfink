import { expect, test, type Page } from '@playwright/test';

/** A new association book, opened. */
async function nyForeningsbok(page: Page, tid = '2026-10-22T10:00:00+02:00') {
  await page.clock.install({ time: new Date(tid) });
  await page.clock.resume();
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Vyer' })
    .getByRole('button', { name: 'Mer' })
    .click();
  await page.getByRole('button', { name: 'Böcker' }).click();
  await page.getByLabel('Namn på den nya boken').fill('Bygdegårdsföreningen');
  await page.getByRole('button', { name: 'Ideell förening' }).click();
  await page.getByRole('button', { name: 'Skapa och öppna boken' }).click();
  await expect(page.getByTestId('aktiv-bok')).toContainText('Bygdegårdsföreningen');
}

async function registrera(page: Page, namn: string, varde: string, ar: string) {
  await page.getByLabel('Tillgångens benämning').fill(namn);
  await page.getByLabel('Tillgångens anskaffningsvärde').fill(varde);
  await page.getByLabel('Uppskattad nyttjandeperiod, år').fill(ar);
  await page.getByTestId('registrera-anlaggning').click();
  await expect(page.getByTestId('anlaggning-besked')).toContainText('registrerad');
}

test("depreciates an association's inventarier one by one, not as a firm's pool", async ({
  page,
}) => {
  // Bought in December and written off in January, when the year is closed.
  await nyForeningsbok(page, '2026-12-20T10:00:00+01:00');
  await page.goto('/#anlaggning');

  await expect(page.getByTestId('anlaggning-inledning')).toContainText(
    'var och en för sig',
  );
  // None of the firm's pool: no percentages, no kompletteringsregel, no pool accounts.
  await expect(page.getByTestId('berakna-avskrivning')).toHaveCount(0);
  await expect(page.getByLabel('Konton för potten, kommaseparerat')).toHaveCount(0);

  // 50 000 kr over five years, bought this year: a full 10 000 kr this year.
  await registrera(page, 'Ljudanläggning', '50000', '5');

  await page.clock.setSystemTime(new Date('2027-01-20T10:00:00+01:00'));
  await page.reload();
  await page.getByLabel('Räkenskapsår', { exact: true }).selectOption({ label: '2026' });

  await expect(page.getByTestId('linjar-rader')).toContainText('Ljudanläggning');
  await expect(page.getByTestId('linjar-summa')).toContainText('10 000,00');

  // The accounts are the association's own, which exist in its kontoplan.
  const linjar = page.getByTestId('linjar-avskrivning');
  await expect(linjar.getByLabel('Kostnadskonto för avskrivningen')).toHaveValue('7830');
  await expect(linjar.getByLabel('Kontot för ackumulerade avskrivningar')).toHaveValue(
    '1228',
  );

  await page.getByTestId('bokfor-linjar-avskrivning').click();
  await expect(page.getByTestId('anlaggning-besked')).toContainText('A1 bokfört');

  await page.goto('/#verifikat');
  await page.getByLabel('Räkenskapsår').selectOption({ label: '2026' });
  await page.getByTestId('verifikatlista').getByRole('button').first().click();
  const konteringar = page.getByTestId(/^kontering-/);
  await expect(konteringar).toContainText('7830');
  await expect(konteringar).toContainText('1228');
  await expect(konteringar).toContainText('10 000,00');
});

test('says nothing is to be written off when the register is empty', async ({ page }) => {
  await nyForeningsbok(page);
  await page.goto('/#anlaggning');

  await expect(page.getByTestId('linjar-inga-rader')).toBeVisible();
  await expect(page.getByTestId('bokfor-linjar-avskrivning')).toBeDisabled();
});

test("applies an association's one condition for a cost booked at once, not a firm's two", async ({
  page,
}) => {
  await nyForeningsbok(page);
  await page.goto('/#anlaggning');

  // Half a prisbasbelopp for 2026 is 29 600 kr: below it, the rule is punkt 6.27.
  await page.getByLabel('Tillgångens benämning').fill('Högtalare');
  await page.getByLabel('Tillgångens anskaffningsvärde').fill('9000');
  await page.getByLabel('Uppskattad nyttjandeperiod, år').fill('10');
  await expect(page.getByTestId('direktavdrag-varning')).toContainText('punkt 6.27');

  // A short period alone is a firm's condition and means nothing to an association.
  await page.getByLabel('Tillgångens anskaffningsvärde').fill('50000');
  await page.getByLabel('Uppskattad nyttjandeperiod, år').fill('2');
  await expect(page.getByTestId('direktavdrag-varning')).toHaveCount(0);
});

test("offers the association's own accounts for a building's depreciation", async ({
  page,
}) => {
  await nyForeningsbok(page);
  await page.goto('/#anlaggning');

  await page.getByLabel('Komponentens benämning').fill('Samlingslokalen');
  await page.getByLabel('Komponentens anskaffningsvärde').fill('1000000');
  await page.getByTestId('registrera-fastighet').click();
  await expect(page.getByTestId('fastighet-besked')).toBeVisible();

  await page.getByTestId('fastighetslista').getByRole('button').first().click();
  const detalj = page.getByTestId(/^fastighet-detalj-/);
  await expect(detalj.getByLabel('Kostnadskonto för avskrivningen')).toHaveValue('7820');
  // The firm's 1129 is not in an association's kontoplan; its 1118 is.
  await expect(detalj.getByLabel('Kontot för ackumulerade avskrivningar')).toHaveValue(
    '1118',
  );
});
