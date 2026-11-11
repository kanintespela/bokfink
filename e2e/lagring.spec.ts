import { expect, test, type Page } from '@playwright/test';

/**
 * Chromium decides on its own whether to promise persistence, so the answers
 * are put in the page's hands: the warning is about what the app does with
 * each answer, not about what a browser happens to say today.
 */
async function lagringSvarar(page: Page, svar: { persisted: boolean; persist: boolean }) {
  await page.addInitScript((val) => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persisted: () => Promise.resolve(val.persisted),
        persist: () => Promise.resolve(val.persist),
        estimate: () => Promise.resolve({ usage: 0, quota: 1_000_000_000 }),
      },
    });
  }, svar);
}

async function bokforEtt(page: Page): Promise<void> {
  await page.goto('/#bokfor');
  await page.getByLabel('Sök').fill('kontorsmaterial');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Kontorsmaterial/ })
    .click();
  await page.getByLabel('Att betala').fill('250');
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByText(/Bokfört som/)).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Vyer' })
    .getByRole('button', { name: 'Översikt' })
    .click();
}

test('says nothing about storage while there is nothing to lose', async ({ page }) => {
  await lagringSvarar(page, { persisted: false, persist: false });
  await page.goto('/');
  await page.getByTestId('valkomst-borja').click();
  await expect(page.getByTestId('inget-bokfort')).toBeVisible();
  await expect(page.getByTestId('lagring-ej-sparad')).toHaveCount(0);
});

test('warns once something is booked and the browser has not promised', async ({
  page,
}) => {
  await lagringSvarar(page, { persisted: false, persist: false });
  await bokforEtt(page);
  await expect(page.getByTestId('lagring-ej-sparad')).toBeVisible();

  await page.getByTestId('be-om-lagring').click();
  await expect(page.getByTestId('lagring-nej')).toBeVisible();
});

test('the warning goes when the browser agrees', async ({ page }) => {
  await lagringSvarar(page, { persisted: false, persist: true });
  await bokforEtt(page);
  await page.getByTestId('be-om-lagring').click();
  await expect(page.getByTestId('lagring-ej-sparad')).toHaveCount(0);
});

test('no warning when the browser has already promised', async ({ page }) => {
  await lagringSvarar(page, { persisted: true, persist: true });
  await bokforEtt(page);
  await expect(page.getByTestId('lagring-ej-sparad')).toHaveCount(0);
});
