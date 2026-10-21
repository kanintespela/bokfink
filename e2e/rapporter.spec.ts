import { expect, test, type Page } from '@playwright/test';

/** Books one expense and one sale, so both reports have something to show. */
async function bokforNagot(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('main').getByRole('button', { name: 'Bokför' }).click();

  await page.getByLabel('Sök').fill('lamm');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Försäljning av djur/ })
    .click();
  await page.getByLabel('Att få in').fill('12500');
  // Through the company account, so the report has an asset side. Private
  // money is the default because most of the real entries are paid that way.
  await page.getByRole('button', { name: 'Företagskontot' }).click();
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await page.getByLabel('Att betala').fill('6250');
  await page.getByRole('button', { name: 'Företagskontot' }).click();
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();
}

/*
 * The stage's acceptance criterion, on a phone: the figures a person would
 * work out by hand, in a report that is readable at 375 px.
 *
 * A sale of 12 500 including 2 500 VAT is 10 000 of income; a purchase of
 * 6 250 including 1 250 VAT is 5 000 of cost. The result is 5 000.
 */
test('shows the result worked out from what was booked', async ({ page }) => {
  await bokforNagot(page);

  await page.goto('/#rapporter');
  await page.getByRole('button', { name: 'Resultat', exact: true }).click();

  const rapport = page.getByTestId('resultatrakning');
  await expect(rapport).toContainText('3000');
  await expect(rapport).toContainText('10 000,00');
  // A cost is printed negative, which is how a resultaträkning reads.
  await expect(rapport).toContainText('-5 000,00');
  await expect(page.getByTestId('summa-Periodens resultat')).toContainText('5 000,00');
});

/*
 * The invariant that makes a balance sheet worth reading at all. The result
 * accounts are not closed into equity until the bokslut, so the report has to
 * carry the result as its own line for the two sides to meet.
 */
test('shows a balance sheet that balances', async ({ page }) => {
  await bokforNagot(page);

  await page.goto('/#rapporter');
  await page.getByRole('button', { name: 'Balans', exact: true }).click();

  const rapport = page.getByTestId('balansrakning');
  await expect(rapport).toContainText('Kassa och bank');
  await expect(page.getByTestId('summa-Summa tillgångar')).toContainText('6 250,00');
  await expect(page.getByTestId('summa-Periodens resultat')).toContainText('5 000,00');
  await expect(page.getByTestId('summa-Summa eget kapital och skulder')).toContainText(
    '6 250,00',
  );
  await expect(page.getByTestId('balansdifferens')).toBeHidden();
});

test('says when there is no year to compare with', async ({ page }) => {
  await bokforNagot(page);
  await page.goto('/#rapporter');
  await page.getByRole('button', { name: 'Resultat', exact: true }).click();

  await expect(page.getByTestId('rapportperiod')).toContainText('ingen jämförelseperiod');
});

/*
 * The promise the whole project rests on: leaving Kontera costs nothing. A
 * report has to come out as a file that opens somewhere else, in a format
 * that outlives the app.
 */
test('hands the report over as a file a spreadsheet can open', async ({ page }) => {
  await bokforNagot(page);
  await page.goto('/#rapporter');

  await page.getByRole('button', { name: 'Resultat', exact: true }).click();
  const nedladdning = page.waitForEvent('download');
  await page.getByTestId('exportera-csv').click();
  const fil = await nedladdning;

  expect(fil.suggestedFilename()).toMatch(
    /^kontera-resultat-2026-01-01-2026-12-31\.csv$/,
  );

  const innehall = await fil.createReadStream().then(async (strom) => {
    const bitar: Buffer[] = [];
    for await (const bit of strom) {
      bitar.push(bit as Buffer);
    }
    return Buffer.concat(bitar).toString('utf8');
  });

  // The mark Excel needs to read it as UTF-8, semicolons, and decimal commas.
  expect(innehall.charCodeAt(0)).toBe(0xfeff);
  expect(innehall).toContain('Rubrik;Konto;Kontonamn;Belopp');
  expect(innehall).toContain(
    'Rörelsens intäkter;3000;Försäljning och utfört arbete samt övriga momspliktiga intäkter;10000,00',
  );
  expect(innehall).toContain('Periodens resultat;;;5000,00');
});

test('hands the same report over as JSON for a program', async ({ page }) => {
  await bokforNagot(page);
  await page.goto('/#rapporter');

  await page.getByRole('button', { name: 'Resultat', exact: true }).click();
  const nedladdning = page.waitForEvent('download');
  await page.getByTestId('exportera-json').click();
  const fil = await nedladdning;

  const innehall = await fil.createReadStream().then(async (strom) => {
    const bitar: Buffer[] = [];
    for await (const bit of strom) {
      bitar.push(bit as Buffer);
    }
    return Buffer.concat(bitar).toString('utf8');
  });

  const poster = JSON.parse(innehall) as Record<string, unknown>[];
  const forsaljning = poster.find((post) => post['Konto'] === '3000');
  // Whole öre, because anything reading JSON is a program.
  expect(forsaljning?.['Belopp']).toBe(1000000);
});

/*
 * The four questions someone running a one-person firm asks about the year,
 * answered as figures with the pictures underneath. The charts are drawn as
 * SVG by us rather than by a charting library, which is why they can carry
 * their own numbers as text.
 */
test('answers the four questions about the year', async ({ page }) => {
  await bokforNagot(page);
  await page.goto('/#rapporter');

  const tal = page.getByTestId('nyckeltal');
  await expect(tal).toContainText('Resultat i år');
  await expect(tal).toContainText('5 000,00');
  // 12 500 in less 6 250 out.
  await expect(tal).toContainText('6 250,00');
  await expect(tal).toContainText('Moms att betala');
  // 2 500 charged less 1 250 paid.
  await expect(tal).toContainText('1 250,00');

  await expect(page.getByTestId('manadsstaplar')).toBeVisible();
  await expect(page.getByTestId('manadslinje')).toBeVisible();

  const kostnader = page.getByTestId('andelsstaplar');
  await expect(kostnader).toContainText('Varor');
  await expect(kostnader).toContainText('5 000,00');
});

/*
 * November and December have not happened in the middle of October. Drawn as
 * zero bars and a flat stretch of line they read as months that happened and
 * were quiet - which on a phone showing a loss looks like the losses stopped.
 */
test('draws only the months that have begun', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T12:00:00+02:00') });
  await page.clock.resume();
  await bokforNagot(page);
  await page.goto('/#rapporter');

  await expect(
    page.getByTestId('manadsstaplar').locator('rect.diagram__stapel'),
  ).toHaveCount(10);
  await expect(
    page.getByTestId('manadslinje').locator('circle.diagram__punkt'),
  ).toHaveCount(10);
});

/*
 * A picture without figures only says up or down. The figure for the latest
 * month is written above each chart, a tapped month takes its place - a
 * phone has no hover - and every month is a tap away as a list.
 */
test('says what each month of the charts stands for', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T12:00:00+02:00') });
  await page.clock.resume();
  await bokforNagot(page);
  await page.goto('/#rapporter');

  const resultat = page.getByTestId('manadsstaplar-avlasning');
  await expect(resultat).toContainText('Oktober 2026 hittills');
  await expect(resultat).toContainText('5 000,00');
  const kassa = page.getByTestId('manadslinje-avlasning');
  await expect(kassa).toContainText('I dag');
  await expect(kassa).toContainText('6 250,00');

  // The scale says how far the bars reach.
  await expect(page.getByTestId('manadsstaplar').locator('svg')).toContainText(
    '5 000,00',
  );

  // January, before anything was booked.
  await page
    .getByTestId('manadsstaplar')
    .locator('rect.diagram__traffyta')
    .first()
    .click();
  await expect(resultat).toContainText('Januari 2026');
  await expect(resultat).toContainText('0,00');
  await page.getByTestId('manadslinje').locator('rect.diagram__traffyta').nth(8).click();
  await expect(kassa).toContainText('I slutet av september 2026');

  const siffror = page.getByTestId('manadsstaplar').locator('details');
  await siffror.getByText('Visa siffrorna').click();
  await expect(siffror).toContainText('Februari 2026');
  await expect(siffror).toContainText('Oktober 2026 hittills');
  // Ten months, the ones that have begun.
  await expect(siffror.locator('dt')).toHaveCount(10);
});
