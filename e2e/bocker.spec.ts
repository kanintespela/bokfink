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
  for (const dold of ['NE-bilaga', 'Djurlager', 'Moms']) {
    await expect(page.getByRole('button', { name: dold, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('button', { name: 'Företaget' })).toBeVisible();
  // Its year-end statement is the association's own form, not the K1 one.
  await expect(page.getByRole('button', { name: 'Förenklat årsbokslut' })).toBeVisible();

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

test("books an association's bill by answering what happened, with no moms split off", async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-22T10:00:00+02:00') });
  await page.clock.resume();

  await oppnaBocker(page);
  await page.getByLabel('Namn på den nya boken').fill('Bygdegårdsföreningen');
  await page.getByRole('button', { name: 'Ideell förening' }).click();
  await page.getByRole('button', { name: 'Skapa och öppna boken' }).click();
  await expect(page.getByTestId('aktiv-bok')).toContainText('Bygdegårdsföreningen');

  await page.goto('/#bokfor');
  await expect(page.getByRole('heading', { name: 'Vad har hänt?' })).toBeVisible();
  // Nothing about animals, machines or egna uttag: the association's own questions.
  await expect(
    page.getByTestId('svar').getByRole('button', { name: 'Moms' }),
  ).toHaveCount(0);

  await page
    .getByTestId('svar')
    .getByRole('button', { name: 'Pengar ut', exact: true })
    .click();
  await page.getByTestId('svar').getByRole('button', { name: 'Fastigheten' }).click();
  await page.getByTestId('svar').getByRole('button', { name: /^El/ }).click();

  await expect(page.getByTestId('valt-lov')).toContainText('5020');
  await page.getByLabel('Att betala').fill('1250');
  // A firm would show the VAT inside 1 250 kr; an association that is not
  // registered pays it as part of the cost.
  await expect(page.getByTestId('momsdelning')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Bankkontot' })).toBeVisible();

  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toContainText('A1');
});

test("takes up an association's decided grant at the year's end and reverses it", async ({
  page,
}) => {
  // The year's end is worked in January, when the books for the year are closed.
  await page.clock.install({ time: new Date('2026-12-20T10:00:00+01:00') });
  await page.clock.resume();

  await oppnaBocker(page);
  await page.getByLabel('Namn på den nya boken').fill('Bygdegårdsföreningen');
  await page.getByRole('button', { name: 'Ideell förening' }).click();
  await page.getByRole('button', { name: 'Skapa och öppna boken' }).click();
  await expect(page.getByTestId('aktiv-bok')).toContainText('Bygdegårdsföreningen');

  await page.clock.setSystemTime(new Date('2027-01-20T10:00:00+01:00'));
  await page.goto('/#periodisering');

  // The association's own items come first, and none of them has moms.
  await expect(page.getByLabel('Vad gäller det?')).toHaveValue('beslutat_bidrag');
  await expect(page.getByTestId('bokslutspost-forklaring')).toContainText('beslutat');
  await expect(page.getByLabel('Moms', { exact: true })).toHaveCount(0);

  await page.getByLabel('Beskrivning').fill('Kommunalt bidrag 2026');
  await page.getByLabel('Belopp utan moms').fill('40000');

  // Taking it up needs the decision, said in so many words.
  await expect(page.getByTestId('bokslutspost-hinder')).toContainText('beslut');
  await expect(page.getByTestId('bokfor-bokslutspost')).toBeDisabled();
  await page.getByLabel('Beslut och dokumentation').selectOption('ja');

  await expect(page.getByTestId('bokslutspost-forslag')).toContainText('1600');
  await expect(page.getByTestId('bokslutspost-forslag')).toContainText('3710');
  await page.getByTestId('bokfor-bokslutspost').click();
  await expect(page.getByTestId('bokslutspost-besked')).toContainText('2026-12-31');
});

test("sets an association's year out on the form of bilaga 2, ready to sign", async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-22T10:00:00+02:00') });
  await page.clock.resume();

  await oppnaBocker(page);
  await page.getByLabel('Namn på den nya boken').fill('Bygdegårdsföreningen');
  await page.getByRole('button', { name: 'Ideell förening' }).click();
  await page.getByRole('button', { name: 'Skapa och öppna boken' }).click();
  await expect(page.getByTestId('aktiv-bok')).toContainText('Bygdegårdsföreningen');

  // 30 000 kr in membership fees and a 1 250 kr electricity bill.
  await page.goto('/#bokfor');
  await page
    .getByTestId('svar')
    .getByRole('button', { name: 'Pengar in', exact: true })
    .click();
  await page
    .getByTestId('svar')
    .getByRole('button', { name: /Medlemsavgift/ })
    .click();
  await page.getByLabel('Att få in').fill('30000');
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toContainText('A1');
  await page
    .getByTestId('svar')
    .getByRole('button', { name: 'Pengar ut', exact: true })
    .click();
  await page.getByTestId('svar').getByRole('button', { name: 'Fastigheten' }).click();
  await page.getByTestId('svar').getByRole('button', { name: /^El/ }).click();
  await page.getByLabel('Att betala').fill('1250');
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toContainText('A2');

  // The year has ended by the time the bokslut is made, which is when the result
  // can be moved onto eget kapital: nothing is booked with a date ahead.
  await page.clock.setSystemTime(new Date('2027-01-20T10:00:00+01:00'));
  await page.goto('/#arsbokslut');
  await page.getByLabel('Räkenskapsår').selectOption({ label: '2026' });
  const bokslut = page.getByTestId('foreningsbokslut');
  await expect(bokslut).toContainText('Förenklat årsbokslut för räkenskapsåret');
  await expect(page.getByTestId('rad-medlemsavgifter')).toContainText('30 000');
  await expect(page.getByTestId('rad-ovriga_externa_kostnader')).toContainText('1 250');
  await expect(page.getByTestId('arets-resultat')).toContainText('28 750');
  // A post with nothing to show is left out, and no post is added to the form.
  await expect(page.getByTestId('rad-forsaljningsintakter')).toHaveCount(0);
  await expect(page.getByTestId('rad-verksamhetskostnader')).toHaveCount(0);
  // The balance sheet balances, and has no comparatives to show for a first year.
  await expect(page.getByTestId('rad-kassa_och_bank')).toContainText('28 750');
  await expect(page.getByTestId('summa-ek-skulder')).toContainText('28 750');
  await expect(page.getByTestId('inga-jamforelsetal')).toBeVisible();

  // The association decides which post an account is on: the electricity is
  // an activity cost for a hall that is let out, in this association's view.
  await page.getByLabel(/^5020/).selectOption({ label: 'Verksamhetskostnader' });
  await expect(page.getByTestId('rad-verksamhetskostnader')).toContainText('1 250');
  await expect(page.getByTestId('rad-ovriga_externa_kostnader')).toHaveCount(0);
  await expect(page.getByTestId('arets-resultat')).toContainText('28 750');

  // The result is moved onto eget kapital on request, and the form reads the same.
  await page.getByTestId('bokfor-resultatoverforing').click();
  await expect(page.getByTestId('foreningsbokslut-besked')).toContainText('bokfört');
  await expect(page.getByTestId('resultatoverforing')).toHaveCount(0);
  await expect(page.getByTestId('arets-resultat')).toContainText('28 750');

  // The board signs: every member gets a line.
  await page.getByLabel('Namn', { exact: true }).fill('Exempel Ordförande');
  await page.getByLabel('Roll i styrelsen').fill('ordförande');
  await page.getByTestId('lagg-till-ledamot').click();
  await expect(page.getByTestId('underskrifter')).toContainText(
    'Exempel Ordförande, ordförande',
  );
});

test('takes an empty book away without asking, and the open one falls back to the first', async ({
  page,
}) => {
  await oppnaBocker(page);
  await page.getByLabel('Namn på den nya boken').fill('Tillfälligt');
  await page.getByRole('button', { name: 'Ideell förening' }).click();
  await page.getByRole('button', { name: 'Skapa och öppna boken' }).click();
  await expect(page.getByTestId('aktiv-bok')).toContainText('Tillfälligt');

  await page.getByRole('button', { name: 'Byt bok' }).click();
  await page.getByRole('button', { name: 'Ta bort Tillfälligt' }).click();

  // No question, and the first book is open again - the app starts over in it,
  // so there is no message left to read. The book is gone from the list.
  await expect(page.getByTestId('bok-borttagen')).toContainText(
    'Tillfälligt är borttagen',
  );
  await expect(page.getByTestId('aktiv-bok')).toHaveCount(0);
  await oppnaBocker(page);
  await expect(page.getByRole('button', { name: /Tillfälligt/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Ta bort en bok' })).toHaveCount(0);
});

test('asks for the name of a book with something in it before taking it away', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-10-22T10:00:00+02:00') });
  await page.clock.resume();

  await oppnaBocker(page);
  await page.getByLabel('Namn på den nya boken').fill('Provboken');
  await page.getByRole('button', { name: 'Enskild firma' }).click();
  await page.getByRole('button', { name: 'Skapa och öppna boken' }).click();
  await expect(page.getByTestId('aktiv-bok')).toContainText('Provboken');
  await bokforEtt(page, 'Kontorsmaterial i provboken');

  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Vyer' })
    .getByRole('button', { name: 'Mer' })
    .click();
  await page.getByRole('button', { name: 'Böcker' }).click();
  await page.getByRole('button', { name: 'Ta bort Provboken' }).click();

  // It has a verifikat, so it is not gone yet: the name has to be typed.
  const bekrafta = page.getByTestId('bekrafta-borttagning');
  await expect(bekrafta).toContainText('1 verifikat');
  await expect(bekrafta).toContainText('sju år');
  await expect(page.getByTestId('ta-bort-bok')).toBeDisabled();

  await page.getByLabel(/Skriv bokens namn/).fill('provboken');
  await expect(page.getByTestId('ta-bort-bok')).toBeDisabled();
  await page.getByLabel(/Skriv bokens namn/).fill('Provboken');
  await page.getByTestId('ta-bort-bok').click();

  await expect(page.getByTestId('bok-borttagen')).toContainText('Provboken är borttagen');
  await expect(page.getByTestId('aktiv-bok')).toHaveCount(0);
  // And it stays gone after a reload.
  await page.reload();
  await oppnaBocker(page);
  await expect(page.getByRole('button', { name: /Provboken/ })).toHaveCount(0);
});

test('offers no way to take away the first book', async ({ page }) => {
  await oppnaBocker(page);
  await expect(page.getByRole('heading', { name: 'Ta bort en bok' })).toHaveCount(0);
});
