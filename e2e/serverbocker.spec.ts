import { expect, test, type Page } from '@playwright/test';

/*
 * Fetching a book from the sync server onto a second device. The server is
 * played by the routes below, which answer as PocketBase does with the
 * schema in server/pocketbase/pb_migrations: one book on it, an
 * association's, described but with nothing booked yet.
 */
const SERVER = 'https://synk.example';
const SERVERBOK = '019b76da-a800-7000-8000-00000000b00c';

/** Every request for entries or files, by the book it named. */
type Fragor = { bok: string | null; samling: string }[];

async function spelaServer(page: Page): Promise<Fragor> {
  const fragor: Fragor = [];
  const json = (kropp: unknown) => ({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(kropp),
  });

  await page.route(`${SERVER}/**`, async (route) => {
    const forfragan = route.request();
    const url = new URL(forfragan.url());

    if (forfragan.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': '*',
        },
      });
      return;
    }
    if (url.pathname.includes('/users/auth-')) {
      await route.fulfill(json({ token: 'en-token' }));
      return;
    }

    const samling = /collections\/(\w+)\/records/.exec(url.pathname)?.[1] ?? '';
    if (forfragan.method() !== 'GET') {
      await route.fulfill(json({}));
      return;
    }
    if (samling === 'bocker') {
      const beskrivning = JSON.stringify({
        namn: 'Bygdegårdsföreningen',
        profil: 'forening',
        momsregistrerad: false,
      });
      const filter = url.searchParams.get('filter');
      const rad = { id: 'rad000000000001', bok: SERVERBOK, beskrivning };
      // The list of every book, or the one row a round asks for first.
      await route.fulfill(
        json({ items: filter === null || filter.includes(SERVERBOK) ? [rad] : [] }),
      );
      return;
    }
    fragor.push({ bok: url.searchParams.get('bok'), samling });
    await route.fulfill(json({ items: [] }));
  });

  return fragor;
}

async function oppnaBocker(page: Page) {
  await page
    .getByRole('navigation', { name: 'Vyer' })
    .getByRole('button', { name: 'Mer' })
    .click();
  await page.getByRole('button', { name: 'Böcker' }).click();
}

test('says to log in before a book can be fetched', async ({ page }) => {
  await page.goto('/');
  await oppnaBocker(page);

  await expect(page.getByTestId('serverbocker-utloggad')).toContainText('Logga först in');
  // The first book's identity is the same fixed word on every device.
  await expect(page.getByTestId('bokens-identitet')).toHaveText('kontera');
});

test('fetches a book from the server and opens it as what it is', async ({ page }) => {
  const fragor = await spelaServer(page);

  await page.goto('/#enhet');
  await page.getByLabel('Serverns adress').fill(SERVER);
  await page.getByLabel('E-post').fill('agare@exempel.se');
  await page.getByLabel('Lösenord', { exact: true }).fill('hemligt');
  await page.getByTestId('logga-in').click();
  await expect(page.getByTestId('synk-besked')).toContainText('Inloggad');

  await oppnaBocker(page);
  await page.getByTestId('visa-serverbocker').click();
  const rad = page.getByTestId('serverbocker').getByRole('listitem');
  await expect(rad).toContainText('Bygdegårdsföreningen');
  await expect(rad).toContainText('Ideell förening');

  await page.getByRole('button', { name: 'Hämta Bygdegårdsföreningen' }).click();

  // The fetched book is the open one, under the server's name for it.
  await expect(page.getByTestId('bok-borttagen')).toContainText(
    'Bygdegårdsföreningen är hämtad från servern och öppnad',
  );
  await expect(page.getByTestId('aktiv-bok').first()).toContainText(
    'Bygdegårdsföreningen',
  );

  // Under the server's identity, already logged in, and listed as here.
  await oppnaBocker(page);
  await expect(page.getByTestId('bokens-identitet')).toHaveText(SERVERBOK);
  await page.getByTestId('visa-serverbocker').click();
  await expect(page.getByTestId('serverbocker')).toContainText('Finns här');

  /*
   * What keeps the books apart: every request for entries or files names a
   * book, and once the fetched book is open they name that one.
   */
  await expect.poll(() => fragor.some((fraga) => fraga.bok === SERVERBOK)).toBe(true);
  expect(
    fragor.every((fraga) => fraga.bok === 'kontera' || fraga.bok === SERVERBOK),
  ).toBe(true);
});
