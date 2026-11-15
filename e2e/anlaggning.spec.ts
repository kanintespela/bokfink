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
  // Out of the holding and into the folded section for what has been sold.
  await expect(page.getByTestId('inga-anlaggningar')).toBeVisible();
  await page
    .getByTestId('salda-poster')
    .getByText(/Sålda och utrangerade/)
    .click();
  await expect(page.getByTestId('salda-poster')).toContainText('Betgrep');
  await expect(page.getByTestId('salda-poster')).toContainText('Sålt');
  await expect(page.getByTestId('salda-poster')).toContainText('37 000');
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

test('stops asking about a purchase from the suggestion right after booking', async ({
  page,
}) => {
  await page.goto('/#frikontering');
  await page.getByLabel('Vad avser det?').fill('Redan i registret');
  await page.getByLabel('Konto, rad 1').fill('1150');
  await page.getByLabel('Debet, rad 1').fill('100');
  await page.getByLabel('Konto, rad 2').fill('1930');
  await page.getByLabel('Kredit, rad 2').fill('100');
  await page.getByTestId('bokfor-fri').click();
  await page
    .getByTestId('anlaggningsforslag')
    .getByRole('button', { name: 'Lägg inte in i registret' })
    .click();
  await expect(page.getByTestId('anlaggningsforslag')).toHaveCount(0);
  await page.goto('/#anlaggning');
  await expect(page.getByTestId('oregistrerade-kop')).toHaveCount(0);
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
    .getByRole('button', { name: 'Rättelse av konto läggs inte in i registret' })
    .click();

  await expect(page.getByTestId('oregistrerade-kop')).toContainText('föreslås inte igen');
  await page.goto('/#frikontering');
  await expect(page.getByTestId('anlaggningsforslag')).toHaveCount(0);
});

/*
 * A building owned since 2011 and written off at 4 % for three years before
 * the register was set up here: 77 734 kr, of which 3 × 3 109,36 = 9 328,08
 * is already written off. The register has to start from 68 405,92 kr, which
 * is what the ledger says, and not from the full cost.
 */
test('registers an older building with what is already written off', async ({ page }) => {
  await page.goto('/#anlaggning');

  await page.getByLabel('Vad ska läggas till?').selectOption('byggnad');
  await page.getByLabel('Komponentens benämning').fill('B2 ekonomibyggnader');
  await page.getByLabel('Komponentens anskaffningsdatum').fill('2011-12-01');
  await page.getByLabel('Komponentens anskaffningsvärde').fill('77734');
  await page.getByLabel('Redan avskrivet (valfritt)').fill('9328,08');
  await page.getByTestId('registrera-fastighet').click();
  await expect(page.getByTestId('anlaggning-besked')).toContainText('registrerad');

  const rad = page.getByTestId('fastighetslista');
  await expect(rad).toContainText('4 %');
  await expect(rad).toContainText('68 405,92');
});

test('takes a register entry with no depreciation out again', async ({ page }) => {
  await page.goto('/#anlaggning');
  await page.getByLabel('Vad ska läggas till?').selectOption('markanlaggning');
  await page.getByLabel('Komponentens benämning').fill('Dubblerad brunn');
  await page.getByLabel('Komponentens anskaffningsdatum').fill('2026-11-09');
  await page.getByLabel('Komponentens anskaffningsvärde').fill('79010');
  await page.getByTestId('registrera-fastighet').click();
  await expect(page.getByTestId('anlaggning-besked')).toContainText('registrerad');

  const lista = page.getByTestId('fastighetslista');
  await lista.getByRole('button', { name: /Dubblerad brunn/ }).click();
  await page.locator('[data-testid^="makulera-fastighet-"]').click();
  await page.locator('[data-testid^="makulera-fastighet-"][data-testid$="-ja"]').click();

  await expect(page.getByTestId('inga-fastigheter')).toBeVisible();
  await expect(page.getByTestId('anlaggning-besked')).toContainText('borttagen');
});

test('offers no way to remove an entry that has depreciation', async ({ page }) => {
  await page.goto('/#anlaggning');
  await page.getByLabel('Vad ska läggas till?').selectOption('byggnad');
  await page.getByLabel('Komponentens benämning').fill('B2 ekonomibyggnader');
  await page.getByLabel('Komponentens anskaffningsdatum').fill('2011-12-01');
  await page.getByLabel('Komponentens anskaffningsvärde').fill('77734');
  await page.getByLabel('Redan avskrivet (valfritt)').fill('9328,08');
  await page.getByTestId('registrera-fastighet').click();

  const lista = page.getByTestId('fastighetslista');
  await lista.getByRole('button', { name: /B2 ekonomibyggnader/ }).click();
  await expect(lista).toContainText('kan inte tas bort ur registret');
  await expect(page.locator('[data-testid^="makulera-fastighet-"]')).toHaveCount(0);
});

/*
 * A register kept in a spreadsheet, taken in as one file: listed first,
 * registered only when the button under the list is pressed, and each entry
 * in the register it belongs to. The building has three years at 4 % behind
 * it - 77 734 − 9 328,08 = 68 405,92 kr.
 */
test('reads a register file in, after showing what it holds', async ({ page }) => {
  const registerfil = JSON.stringify({
    format: 'bokfink-anlaggningsregister',
    version: 1,
    inventarier: [
      {
        benamning: 'Sågverk',
        anskaffningsdatum: '2022-01-01',
        anskaffningsvarde: '38100',
        nyttjandeperiod: 5,
      },
    ],
    fastighet: [
      {
        benamning: 'Ekonomibyggnad',
        anskaffningsdatum: '2011-12-01',
        anskaffningsvarde: '77734',
        kategori: 'byggnad',
        byggnadstyp: 'ekonomibyggnad_ovrig',
        ackumuleradAvskrivning: '9328,08',
      },
      {
        benamning: 'Skogen',
        anskaffningsdatum: '2011-12-01',
        anskaffningsvarde: '265922',
        kategori: 'skog',
      },
    ],
  });
  const valj = () =>
    page.getByTestId('registerfil').setInputFiles({
      name: 'register.json',
      mimeType: 'application/json',
      buffer: Buffer.from(registerfil),
    });

  await page.goto('/#anlaggning');
  await valj();

  // Listed, and nothing registered yet.
  const plan = page.getByTestId('registerimportplan');
  await expect(plan).toContainText('Ekonomibyggnad');
  await expect(plan).toContainText('Redan avskrivet 9 328,08');
  await expect(plan).toContainText('Sågverk');
  await expect(page.getByTestId('inga-anlaggningar')).toBeVisible();

  await page.getByTestId('genomfor-registerimport').click();

  await expect(page.getByTestId('anlaggningslista')).toContainText('Sågverk');
  const fastighet = page.getByTestId('fastighetslista');
  await expect(fastighet).toContainText('68 405,92');
  await expect(fastighet).toContainText('Skogen');

  // The same file again adds nothing.
  await valj();
  await expect(plan).toContainText('Allt i filen finns redan i registret');
  await expect(page.getByTestId('genomfor-registerimport')).toHaveCount(0);
});

test('refuses a file that is not a register, and says so', async ({ page }) => {
  await page.goto('/#anlaggning');

  await page.getByTestId('registerfil').setInputFiles({
    name: 'annat.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"handelser":[]}'),
  });

  await expect(
    page.getByRole('region', { name: 'Läs in ett register från fil' }),
  ).toContainText('inte ett anläggningsregister');
  await expect(page.getByTestId('registerimportplan')).toHaveCount(0);
});
