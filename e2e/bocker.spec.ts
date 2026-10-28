import { expect, test, type Page } from '@playwright/test';

/** Books one verifikat by hand: 100 kr of office supplies from the bank. */
async function bokforEtt(page: Page, beskrivning: string) {
  await page.goto('/#frikontering');
  await page.getByLabel('Vad avser det?').fill(beskrivning);
  await page.getByLabel('Konto, rad 1').fill('6100');
  await page.getByLabel('Debet, rad 1').fill('100');
  await page.getByLabel('Konto, rad 2').fill('1930');
  await page.getByLabel('Kredit, rad 2').fill('100');
  await page.getByTestId('bokfor-fri').click();
  await expect(page.getByTestId('fri-besked')).toContainText('A1');
}

async function oppnaBocker(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Vyer' })
    .getByRole('button', { name: 'Mer' })
    .click();
  await page.getByRole('button', { name: 'Böcker' }).click();
}

test('keeps a second book apart from the first', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-22T10:00:00+02:00') });
  await page.clock.resume();

  await bokforEtt(page, 'Kontorsmaterial till firman');

  // One book: no reminder of which is open, since there is nothing to mix up.
  await page.goto('/');
  await expect(page.getByTestId('aktiv-bok')).toHaveCount(0);

  await oppnaBocker(page);
  await page.getByLabel('Namn', { exact: true }).fill('Firman');
  await page.getByRole('button', { name: 'Spara namnet' }).click();
  await expect(page.getByRole('button', { name: /Firman/ })).toBeVisible();

  await page.getByLabel('Namn på den nya boken').fill('Bygdegårdsföreningen');
  await page.getByRole('button', { name: 'Skapa och öppna boken' }).click();

  // The new book is open, said on the screen, and holds nothing of the firm's.
  await expect(page.getByTestId('aktiv-bok')).toContainText('Bygdegårdsföreningen');
  await page.goto('/#verifikat');
  await expect(page.getByTestId('aktiv-bok')).toContainText('Bygdegårdsföreningen');
  await expect(page.getByText('Kontorsmaterial till firman')).toHaveCount(0);

  // Its own series starts at 1, and survives a reload as the open book.
  await bokforEtt(page, 'Kontorsmaterial till föreningen');
  await page.reload();
  await expect(page.getByTestId('aktiv-bok')).toContainText('Bygdegårdsföreningen');

  // Back to the firm: its verifikat is there and the association's is not.
  await page.getByRole('button', { name: 'Byt bok' }).click();
  await page.getByRole('button', { name: /Firman/ }).click();
  await expect(page.getByTestId('aktiv-bok')).toContainText('Firman');
  await page.goto('/#verifikat');
  await expect(page.getByText('Kontorsmaterial till firman')).toBeVisible();
  await expect(page.getByText('Kontorsmaterial till föreningen')).toHaveCount(0);
});

test('refuses a second book with a name already taken', async ({ page }) => {
  await oppnaBocker(page);
  await page.getByLabel('Namn på den nya boken').fill('min bokföring');
  await page.getByRole('button', { name: 'Skapa och öppna boken' }).click();

  await expect(page.getByTestId('datautbyte-fel')).toContainText(
    'Det finns redan en bok som heter Min bokföring.',
  );
  await expect(page.getByTestId('aktiv-bok')).toHaveCount(0);
});
