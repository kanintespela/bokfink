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

test('the example book has a year of bookings, says so, and asks nothing of the visitor', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('valkomst-exempel').click();

  await expect(page.getByTestId('exempelkort')).toBeVisible();
  await expect(page.getByTestId('aktiv-bok')).toContainText(
    'Exempel: Lindgrens Snickeri',
  );
  await expect(page.getByTestId('senaste-verifikat')).toBeVisible();
  // Nothing in it is worth a backup, or a promise from the browser to keep it.
  await expect(page.getByTestId('backup-gammal')).toHaveCount(0);
  await expect(page.getByTestId('lagring-ej-sparad')).toHaveCount(0);

  await vyval(page).getByRole('button', { name: 'Verifikat' }).click();
  await expect(page.getByText('Altanbygge, kund Berg')).toBeVisible();
});

test('removing the example leaves the first book as it was, still blank', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('valkomst-exempel').click();
  await expect(page.getByTestId('exempelkort')).toBeVisible();

  await page.getByTestId('ta-bort-exempel').click();
  await page.getByTestId('ta-bort-exempel-ja').click();

  await expect(page.getByTestId('bok-borttagen')).toContainText('är borttagen');
  await expect(page.getByTestId('exempelkort')).toHaveCount(0);
  // The first book never had its questions answered, so it asks them now.
  await expect(page.getByTestId('valkomst')).toBeVisible();
});

test('the example is one book among the others, listed once', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('valkomst-exempel').click();
  await expect(page.getByTestId('exempelkort')).toBeVisible();

  await page.goto('/#bocker');
  await expect(
    page
      .locator('ul.lista')
      .first()
      .locator('.listrad')
      .filter({ hasText: 'Exempel: Lindgrens Snickeri' }),
  ).toHaveCount(1);
  await expect(
    page
      .locator('ul.lista')
      .first()
      .locator('.listrad')
      .filter({ hasText: 'Min bokföring' }),
  ).toHaveCount(1);
});

/** The first answer offered under "Pengar ut". */
async function forstaUtgiftssvar(page: Page): Promise<string> {
  await page.goto('/#bokfor');
  await page.getByTestId('svar').getByRole('button', { name: 'Pengar ut' }).click();
  return (await page.getByTestId('svar').getByRole('button').first().innerText())
    .split('\n')[0]!
    .trim();
}

test('the trade chosen on the welcome orders the questions, and can be changed later', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Vad gör firman?').selectOption({ label: 'Hantverk eller bygg' });
  await page.getByTestId('valkomst-borja').click();
  await expect(page.getByTestId('valkomst')).toHaveCount(0);

  await expect
    .poll(() => forstaUtgiftssvar(page))
    .toBe('Varor och material som du säljer vidare eller bygger in');

  await page.goto('/#foretag');
  await page
    .getByLabel('Vad gör firman?')
    .selectOption({ label: 'Tjänster eller konsult' });
  // Saved a moment after the choice, so the questions are asked again until they change.
  await expect
    .poll(() => forstaUtgiftssvar(page))
    .toBe('Telefon, internet, program och kontor');
});

test('a book with no recorded trade keeps the questions in the order it has always had', async ({
  page,
}) => {
  // Booking settles the welcome without answering it, so no trade is recorded.
  await page.goto('/#bokfor');
  await page.getByLabel('Sök').fill('kontorsmaterial');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Kontorsmaterial/ })
    .click();
  await page.getByLabel('Att betala').fill('250');
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByText(/Bokfört som/)).toBeVisible();

  expect(await forstaUtgiftssvar(page)).toBe('Djuren');
});

test('rent is found by searching hyra, and is proposed without moms', async ({
  page,
}) => {
  await page.goto('/#bokfor');
  await page.getByLabel('Sök').fill('hyra');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Lokalhyra/ })
    .click();
  await page.getByLabel('Att betala').fill('8000');
  // The rate is the user's to pick, and starts at none.
  await expect(
    page.getByTestId('momsval').getByRole('button', { name: 'Ingen' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Visa konteringen' }).click();
  await expect(page.getByText('5000', { exact: true }).first()).toBeVisible();
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByText(/Bokfört som/)).toBeVisible();
});

test('no one finds a company insurance by typing tåg', async ({ page }) => {
  await page.goto('/#bokfor');
  await page.getByLabel('Sök').fill('tåg');
  const traffar = page.getByTestId('sokresultat');
  await expect(traffar.getByRole('button', { name: /Resa/ })).toBeVisible();
  await expect(traffar.getByRole('button', { name: /Företagsförsäkring/ })).toHaveCount(
    0,
  );
});
