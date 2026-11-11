import { expect, test, type Page } from '@playwright/test';

function vyval(page: Page) {
  return page.getByRole('navigation', { name: 'Vyer' });
}

test('a blank first book opens on the welcome questions, with the tabs still there', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('valkomst')).toBeVisible();
  await expect(vyval(page).getByRole('button', { name: 'Bokför' })).toBeVisible();
  // Nothing to back up yet, so the first screen is not a form for a passphrase.
  await expect(page.getByTestId('backup-gammal')).toHaveCount(0);
  await expect(page.getByLabel('Lösenfras för säkerhetskopian')).toHaveCount(0);
});

test('answering for a firm names the book, sets the moms period and goes away', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Vad heter firman?').fill('Lindgrens Snickeri');
  await page.getByLabel('Hur ofta lämnar du momsdeklaration?').selectOption('manad');
  await page.getByTestId('valkomst-borja').click();

  await expect(page.getByTestId('valkomst')).toHaveCount(0);
  await expect(page.getByTestId('inget-bokfort')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('valkomst')).toHaveCount(0);

  await page.goto('/#foretag');
  await expect(page.getByLabel('Redovisningsperiod för moms')).toHaveValue('manad');
  await page.goto('/#bocker');
  await expect(page.getByText('Lindgrens Snickeri').first()).toBeVisible();
});

test("answering for an association gives the association's book", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ideell förening' }).click();
  await expect(page.getByLabel('Vad heter föreningen?')).toBeVisible();
  // Not registered for moms by default, so no period is asked until it is said.
  await expect(page.getByLabel('Hur ofta lämnar du momsdeklaration?')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ja', exact: true }).click();
  await expect(page.getByLabel('Hur ofta lämnar du momsdeklaration?')).toBeVisible();
  await page.getByRole('button', { name: 'Nej', exact: true }).click();
  await page.getByTestId('valkomst-borja').click();
  await expect(page.getByTestId('valkomst')).toHaveCount(0);

  // The firm's year-end form is not there for an association.
  await vyval(page).getByRole('button', { name: 'Mer' }).click();
  await expect(page.getByRole('button', { name: 'NE-bilaga' })).toHaveCount(0);
  await page.goto('/#konton');
  await expect(page.getByText('Egna uttag')).toHaveCount(0);
});

test('a name that is too long is refused where it is typed', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Vad heter firman?').fill('x'.repeat(41));
  await page.getByTestId('valkomst-borja').click();
  await expect(page.getByTestId('valkomst-fel')).toContainText('högst 40 tecken');
  await expect(page.getByTestId('valkomst')).toBeVisible();
});

test('asks the browser to keep the books when the user presses the button', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const anrop = { persist: 0 };
    (window as unknown as { __anrop: typeof anrop }).__anrop = anrop;
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        persisted: () => Promise.resolve(false),
        persist: () => {
          anrop.persist += 1;
          return Promise.resolve(true);
        },
        estimate: () => Promise.resolve({ usage: 0, quota: 1_000_000_000 }),
      },
    });
  });
  await page.goto('/');
  await expect(page.getByTestId('valkomst')).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { __anrop: { persist: number } }).__anrop.persist,
    ),
  ).toBe(0);
  await page.getByTestId('valkomst-borja').click();
  await expect(page.getByTestId('valkomst')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { __anrop: { persist: number } }).__anrop.persist,
    ),
  ).toBe(1);
});

test('someone with a backup is taken to where it is read in, and not asked again', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('valkomst-aterstall').click();
  await expect(page.getByRole('heading', { name: 'Säkerhetskopia' })).toBeVisible();
  await page.reload();
  await vyval(page).getByRole('button', { name: 'Översikt' }).click();
  await expect(page.getByTestId('valkomst')).toHaveCount(0);
});

test('booking before answering settles the questions: the book is a firm', async ({
  page,
}) => {
  await page.goto('/#bokfor');
  await page.getByLabel('Sök').fill('kontorsmaterial');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Kontorsmaterial/ })
    .click();
  await page.getByLabel('Att betala').fill('250');
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByText(/Bokfört som/)).toBeVisible();
  await vyval(page).getByRole('button', { name: 'Översikt' }).click();
  await expect(page.getByTestId('valkomst')).toHaveCount(0);
  await expect(page.getByTestId('senaste-verifikat')).toBeVisible();
});
