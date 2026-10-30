import { expect, test, type Page } from '@playwright/test';

/** Books one verifikat by hand: 100 kr of office supplies from the bank. */
async function bokforEtt(page: Page, beskrivning: string, kostnadskonto = '6100') {
  await page.goto('/#frikontering');
  await page.getByLabel('Vad avser det?').fill(beskrivning);
  await page.getByLabel('Konto, rad 1').fill(kostnadskonto);
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
  await page.getByRole('button', { name: 'Ideell förening' }).click();
  await page.getByRole('button', { name: 'Skapa och öppna boken' }).click();

  // The new book is open, said on the screen, and holds nothing of the firm's.
  await expect(page.getByTestId('aktiv-bok')).toContainText('Bygdegårdsföreningen');
  await page.goto('/#verifikat');
  await expect(page.getByTestId('aktiv-bok')).toContainText('Bygdegårdsföreningen');
  await expect(page.getByText('Kontorsmaterial till firman')).toHaveCount(0);

  // Its own series starts at 1, and survives a reload as the open book.
  // The association's own accounts: 6110 Kontorsmaterial, where the firm has 6100.
  await bokforEtt(page, 'Kontorsmaterial till föreningen', '6110');
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
  await page.getByRole('button', { name: 'Enskild firma' }).click();
  await page.getByRole('button', { name: 'Skapa och öppna boken' }).click();

  await expect(page.getByTestId('datautbyte-fel')).toContainText(
    'Det finns redan en bok som heter Min bokföring.',
  );
  await expect(page.getByTestId('aktiv-bok')).toHaveCount(0);
});

test('will not create a book before it is said what kind of book it is', async ({
  page,
}) => {
  await oppnaBocker(page);
  await page.getByLabel('Namn på den nya boken').fill('Bygdegårdsföreningen');
  await page.getByRole('button', { name: 'Skapa och öppna boken' }).click();

  await expect(page.getByTestId('datautbyte-fel')).toContainText(
    'Välj om boken är en enskild firma eller en ideell förening.',
  );
  await expect(page.getByTestId('aktiv-bok')).toHaveCount(0);
});

test('an association book has no owner screens and no moms until it is registered', async ({
  page,
}) => {
  await oppnaBocker(page);
  await page.getByLabel('Namn på den nya boken').fill('Bygdegårdsföreningen');
  await page.getByRole('button', { name: 'Ideell förening' }).click();
  await page.getByRole('button', { name: 'Skapa och öppna boken' }).click();
  await expect(page.getByTestId('aktiv-bok')).toContainText('Bygdegårdsföreningen');

  // Under Mer: no NE-bilaga, owner's equity, K1 statement, animal stock or moms.
  await page.goto('/#mer');
  for (const dold of ['NE-bilaga', 'Förenklat årsbokslut', 'Djurlager', 'Moms']) {
    await expect(page.getByRole('button', { name: dold, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: 'Företaget' })).toBeVisible();

  // An address that belongs to the other kind of book opens the overview.
  await page.goto('/#nebilaga');
  await expect(page.getByRole('heading', { name: 'NE-bilaga' })).toHaveCount(0);
  await page.goto('/#moms');
  await expect(page.getByRole('heading', { name: 'Moms', exact: true })).toHaveCount(0);

  // Saying the association is registered for moms brings the moms view back.
  await page.goto('/#foretag');
  await expect(page.getByLabel('Redovisningsperiod för moms')).toHaveCount(0);
  await page.getByLabel('Momsregistrering').selectOption('ja');
  await expect(page.getByLabel('Redovisningsperiod för moms')).toBeVisible();
  await page.goto('/#mer');
  await expect(page.getByRole('button', { name: 'Moms', exact: true })).toBeVisible();
});

test('an association sets funds aside for a purpose without touching the result', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-22T10:00:00+02:00') });
  await page.clock.resume();

  await oppnaBocker(page);
  await page.getByLabel('Namn på den nya boken').fill('Bygdegårdsföreningen');
  await page.getByRole('button', { name: 'Ideell förening' }).click();
  await page.getByRole('button', { name: 'Skapa och öppna boken' }).click();
  await expect(page.getByTestId('aktiv-bok')).toContainText('Bygdegårdsföreningen');

  // The association's own page, not the owner's uttag and insättningar.
  await page.goto('/#mer');
  await page.getByRole('button', { name: 'Eget kapital', exact: true }).click();
  await expect(page.getByTestId('inga-reserverade')).toBeVisible();
  await expect(page.getByText('Eget uttag')).toHaveCount(0);

  await page.getByLabel(/Konto för ändamålet/).fill('2030');
  await page.getByLabel('Namn på ändamålet').fill('Underhåll av lokalen');
  await page.getByLabel('Belopp', { exact: true }).fill('20000');
  await page.getByTestId('bokfor-reservering').click();
  await expect(page.getByTestId('foreningskapital-besked')).toContainText('bokfört');

  await expect(page.getByTestId('reserverade-medel')).toContainText(
    '2030 Underhåll av lokalen',
  );
  await expect(page.getByTestId('summa-reserverat')).toContainText('20 000');

  // Setting funds aside moves capital inside equity: the total does not change.
  await page.getByRole('button', { name: 'Frigör' }).click();
  await page.getByLabel(/Konto för ändamålet/).fill('2030');
  await expect(page.getByTestId('kontonamn')).toContainText('Underhåll av lokalen');
  await page.getByLabel('Belopp', { exact: true }).fill('5000');
  await page.getByTestId('bokfor-reservering').click();
  await expect(page.getByTestId('summa-reserverat')).toContainText('15 000');
});
