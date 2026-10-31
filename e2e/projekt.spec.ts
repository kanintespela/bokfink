import { expect, test, type Page } from '@playwright/test';

async function oppnaProjekt(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Vyer' })
    .getByRole('button', { name: 'Mer' })
    .click();
  await page.getByRole('button', { name: 'Projekt' }).click();
}

test('creates a project, renames it, finishes it and opens it again', async ({
  page,
}) => {
  await oppnaProjekt(page);
  await expect(page.getByTestId('inga-projekt')).toBeVisible();

  await page.getByLabel('Kod').fill('LEADER-28');
  await page.getByLabel('Namn', { exact: true }).fill('Ny scen');
  await page.getByTestId('skapa-projekt').click();
  await expect(page.getByTestId('projektlista')).toContainText('LEADER-28 Ny scen');
  await expect(page.getByTestId('projektlista')).toContainText('Pågår');

  // The same code in other letters is the same project.
  await page.getByLabel('Kod').fill('leader-28');
  await page.getByLabel('Namn', { exact: true }).fill('Dubblett');
  await page.getByTestId('skapa-projekt').click();
  await expect(page.getByRole('alert')).toContainText('finns redan ett projekt');

  await page.getByTestId('byt-namn-LEADER-28').click();
  await page.getByLabel('Nytt namn för LEADER-28').fill('Ny scen vid badplatsen');
  await page.getByTestId('spara-projektnamn').click();
  await expect(page.getByTestId('projektlista')).toContainText(
    'LEADER-28 Ny scen vid badplatsen',
  );

  await page.getByTestId('avsluta-LEADER-28').click();
  await expect(page.getByTestId('projektlista')).toContainText('Avslutat');
  await page.getByTestId('oppna-LEADER-28').click();
  await expect(page.getByTestId('projektlista')).toContainText('Pågår');

  // It is still there after a reload: a post of the log, not of the screen.
  await oppnaProjekt(page);
  await expect(page.getByTestId('projektlista')).toContainText('LEADER-28');
});

test('books a rad on a project with Fri kontering and shows it on the verifikat', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-04-05T10:00:00+02:00') });
  await page.clock.resume();

  await oppnaProjekt(page);
  await page.getByLabel('Kod').fill('LEADER-28');
  await page.getByLabel('Namn', { exact: true }).fill('Ny scen');
  await page.getByTestId('skapa-projekt').click();
  await expect(page.getByTestId('projektlista')).toContainText('LEADER-28');

  await page.goto('/#frikontering');
  await page.getByLabel('Vad avser det?').fill('Virke till scenen');
  await page.getByLabel('Konto, rad 1').fill('6100');
  await page.getByLabel('Debet, rad 1').fill('100');
  await page.getByLabel('Projekt, rad 1').selectOption({ label: 'LEADER-28 Ny scen' });
  await page.getByLabel('Konto, rad 2').fill('1930');
  await page.getByLabel('Kredit, rad 2').fill('100');
  // The bank row is not a cost of the project and says nothing of it.
  await page.getByTestId('bokfor-fri').click();
  await expect(page.getByTestId('fri-besked')).toContainText('A1');

  await page.goto('/#verifikat');
  await page.getByTestId('verifikatlista').getByRole('button', { name: /A1/ }).click();
  const rader = page.getByTestId(/^kontering-/).getByRole('listitem');
  await expect(rader.nth(0)).toContainText('LEADER-28');
  await expect(rader.nth(1)).not.toContainText('LEADER-28');
});

test('does not offer the field while there is no project', async ({ page }) => {
  await page.goto('/#frikontering');
  await expect(page.getByLabel('Konto, rad 1')).toBeVisible();
  await expect(page.getByLabel('Projekt, rad 1')).toHaveCount(0);
});

test('puts the cost row of a guided booking on a project, and not the payment or the moms', async ({
  page,
}) => {
  await oppnaProjekt(page);
  await page.getByLabel('Kod').fill('LEADER-28');
  await page.getByLabel('Namn', { exact: true }).fill('Ny scen');
  await page.getByTestId('skapa-projekt').click();
  await expect(page.getByTestId('projektlista')).toContainText('LEADER-28');

  await page.goto('/#bokfor');
  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await page.getByLabel('Att betala').fill('1000');
  await page
    .getByLabel('Projekt (kostnaden)')
    .selectOption({ label: 'LEADER-28 Ny scen' });

  await page.getByRole('button', { name: 'Visa konteringen' }).click();
  const kontering = page.getByTestId('kontering').getByRole('listitem');
  await expect(kontering).toHaveCount(3);
  await expect(kontering.nth(0)).toContainText('LEADER-28');
  await expect(kontering.nth(1)).not.toContainText('LEADER-28');
  await expect(kontering.nth(2)).not.toContainText('LEADER-28');

  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toContainText('A1');

  // The field starts over for the next entry rather than carrying the project on.
  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await expect(page.getByLabel('Projekt (kostnaden)')).toHaveValue('');
});
