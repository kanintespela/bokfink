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
