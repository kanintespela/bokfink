import { expect, test, type Page } from '@playwright/test';

/**
 * A one-pixel PNG. Enough for the browser to decode, scale and re-encode,
 * which is the path a photographed receipt takes; the picture itself is not
 * what is being tested.
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Picks the file and keeps the whole picture.
 *
 * A single image always offers the crop step first, so every test that only
 * cares about what happens afterwards goes through it.
 */
async function lamnaKvitto(page: Page): Promise<void> {
  await page.getByTestId('valj-underlag').setInputFiles({
    name: 'kvitto.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await sparaTrotsOmdome(page);
}

/**
 * Saves, acknowledging the quality warning that a one-pixel picture earns.
 *
 * The warning is a warning: pressing save again stores the picture as it is,
 * because only the person holding the receipt knows whether there is a second
 * chance at photographing it.
 */
async function sparaTrotsOmdome(page: Page, knapp = 'spara-hela'): Promise<void> {
  const spara = page.getByTestId(knapp);
  await spara.click();

  // The verdict is measured, so it arrives a moment after the click.
  const varnat = await page
    .getByTestId('bildomdome')
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);

  if (varnat) {
    await spara.click();
  }
}

/*
 * The half of stage 3 that has to work before anything else does: a receipt
 * is safe the moment it is photographed, even though nothing is booked yet.
 */
test('stores a photographed receipt and lists it as waiting', async ({ page }) => {
  await page.goto('/#kvitton');
  await lamnaKvitto(page);

  await expect(page.getByTestId('kvitto-besked')).toContainText('sparades');
  await expect(page.getByTestId('kvittolista').getByRole('listitem')).toHaveCount(1);

  // Stored as JPEG whatever came in, so an archive opens in seven years.
  await expect(page.getByRole('button', { name: /Visa kvitto\.jpg/ })).toBeVisible();
});

test('recognises a receipt it already has', async ({ page }) => {
  await page.goto('/#kvitton');

  await lamnaKvitto(page);
  await expect(page.getByTestId('kvitto-besked')).toContainText('sparades');

  await lamnaKvitto(page);
  await expect(page.getByTestId('kvitto-besked')).toContainText('fanns redan');
  await expect(page.getByTestId('kvittolista').getByRole('listitem')).toHaveCount(1);
});

test('shows waiting receipts on the start view', async ({ page }) => {
  await page.goto('/#kvitton');
  await lamnaKvitto(page);
  await expect(page.getByTestId('kvitto-besked')).toBeVisible();

  await page.goto('/');
  await expect(page.getByTestId('kvitton-vantar')).toContainText('Ett kvitto');
});

/*
 * The flow stage 3 exists for: photograph in the shop, book in the evening,
 * and the verifikat carries its evidence afterwards.
 */
test('books a photographed receipt and keeps it attached', async ({ page }) => {
  await page.goto('/#kvitton');
  await lamnaKvitto(page);
  await expect(page.getByTestId('kvitto-besked')).toBeVisible();

  await page.getByRole('button', { name: 'Bokför kvittot' }).click();

  // The receipt follows into the form, so what is being booked stays visible.
  await expect(page.getByTestId('valt-underlag')).toContainText('kvitto.jpg');

  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await page.getByLabel('Att betala').fill('520,31');
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();

  await expect(page.getByTestId('senast-bokfort')).toContainText('A1');

  // Booked, so it is no longer waiting.
  await page.goto('/#kvitton');
  await expect(page.getByTestId('inga-kvitton')).toBeVisible();

  await page.goto('/#verifikat');
  await page.getByTestId('verifikatlista').getByRole('button', { name: /A1/ }).click();
  const underlag = page.locator('[data-testid^="underlag-"]');
  await expect(underlag).toContainText('kvitto.jpg');
  // The evidence is openable, not just named - inside the app, because a new
  // window from the home screen could not reach the file.
  await underlag.getByRole('button', { name: 'Öppna' }).click();
  const visning = page.getByTestId('underlagsvisning');
  await expect(visning.getByRole('img', { name: 'Underlag kvitto.jpg' })).toBeVisible();
  await visning.getByRole('button', { name: 'Stäng' }).click();
  await expect(visning).toBeHidden();
});

/*
 * Cropping happens on the way in and never afterwards: a stored underlag is
 * räkenskapsinformation, and bokföringslagen 7 kap. 2 § wants it kept as it
 * was. Skipping it is a button rather than a hidden default.
 */
test('offers to crop a photograph before storing it', async ({ page }) => {
  await page.goto('/#kvitton');
  await page.getByTestId('valj-underlag').setInputFiles({
    name: 'kvitto.png',
    mimeType: 'image/png',
    buffer: PNG,
  });

  await expect(page.getByRole('heading', { name: 'Beskär' })).toBeVisible();

  const horn = page.getByTestId('horn-x1y1');
  const fran = await horn.boundingBox();
  const bild = await page.locator('.beskar').boundingBox();
  if (fran === null || bild === null) {
    throw new Error('ingen bild att beskära');
  }

  await page.mouse.move(fran.x + fran.width / 2, fran.y + fran.height / 2);
  await page.mouse.down();
  await page.mouse.move(bild.x + bild.width / 3, bild.y + bild.height / 3, { steps: 8 });
  await page.mouse.up();

  await sparaTrotsOmdome(page, 'spara-beskuret');
  await expect(page.getByTestId('kvitto-besked')).toContainText('sparades');
  await expect(page.getByTestId('kvittolista').getByRole('listitem')).toHaveCount(1);
});

/*
 * A mis-shot is a picture, not räkenskapsinformation, and a list that cannot
 * be tidied stops being read. What a booked verifikat rests on is a different
 * thing: it never appears here, because this list is what nothing has claimed.
 */
test('throws away a receipt that has not been booked', async ({ page }) => {
  await page.goto('/#kvitton');
  await lamnaKvitto(page);
  await expect(page.getByTestId('kvittolista').getByRole('listitem')).toHaveCount(1);

  await page.getByRole('button', { name: 'Ta bort' }).click();
  // Confirmed, because the picture does not come back.
  await expect(page.getByText('Ta bort bilden?')).toBeVisible();
  await page.getByRole('button', { name: 'Ja, ta bort' }).click();

  await expect(page.getByTestId('kvitto-besked')).toContainText('togs bort');
  await expect(page.getByTestId('inga-kvitton')).toBeVisible();

  // And it is gone for good, not merely hidden.
  await page.reload();
  await expect(page.getByTestId('inga-kvitton')).toBeVisible();
});

test('keeps a receipt that a verifikat rests on', async ({ page }) => {
  await page.goto('/#kvitton');
  await lamnaKvitto(page);
  await page.getByRole('button', { name: 'Bokför kvittot' }).click();
  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await page.getByLabel('Att betala').fill('520,31');
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  // Booked, so it is not on the list of unclaimed pictures - and there is
  // nowhere to throw it away from.
  await page.goto('/#kvitton');
  await expect(page.getByTestId('inga-kvitton')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ta bort' })).toBeHidden();
});

/*
 * A supplier's invoice arrives as a PDF with a real text layer, and reading
 * that layer is a different job from reading a photograph: the characters are
 * already characters. Both real invoices tested came out exactly right, where
 * two of four photographed receipts could not be read at all.
 *
 * The fixture is a minimal PDF written for this test - its totals row has the
 * shape a real invoice has, with the figure to book standing under the last
 * of several headings.
 */
test('reads a PDF invoice and offers what it says', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('/#kvitton');
  await page.getByTestId('valj-underlag').setInputFiles('e2e/fixtures/faktura.pdf');

  await expect(page.getByTestId('kvitto-besked')).toContainText('sparades');
  await page.getByRole('button', { name: 'Bokför kvittot' }).click();

  // 500,00 under "ATT BETALA", not the 400,00 under "Totalt exkl moms".
  const erbjudande = page.getByTestId('anvand-kvittot');
  await expect(erbjudande).toBeVisible({ timeout: 60_000 });
  await expect(erbjudande).toContainText('500,00');
  await expect(erbjudande).toContainText('2026-08-18');

  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await erbjudande.click();

  await expect(page.getByLabel('Att betala')).toHaveValue('500,00');
  // The VAT the invoice states, not a fifth of the total - which here is the
  // same figure, and the posting has to show it either way.
  await expect(page.getByTestId('momsdelning')).toContainText('100,00');
});

/**
 * Takes away what Safari on an iPhone does not have.
 *
 * pdf.js reads a page's text with `for await` over a ReadableStream, and
 * WebKit's ReadableStream cannot be iterated that way - on the phone that
 * surfaced as "undefined is not a function (near '...e of t...')" and no
 * text at all. The newest language additions pdf.js leans on go too, since
 * an iPhone a version or two behind lacks them as well. Run in the page and,
 * prepended to its script, in pdf.js's own worker.
 */
const SOM_SAFARI = `(() => {
  delete ReadableStream.prototype[Symbol.asyncIterator];
  delete ReadableStream.prototype.values;
  for (const typ of [Map, WeakMap]) {
    delete typ.prototype.getOrInsertComputed;
    delete typ.prototype.getOrInsert;
  }
  delete Math.sumPrecise;
  delete Promise.try;
  delete Uint8Array.fromBase64;
  delete Uint8Array.prototype.toBase64;
  delete Uint8Array.prototype.toHex;
})();
`;

test('reads a PDF invoice in a browser that cannot iterate a stream', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  // Without a service worker, so the worker script below comes over the
  // network where it can be rewritten rather than out of the cache.
  const kontext = await browser.newContext({ serviceWorkers: 'block' });
  const page = await kontext.newPage();
  await page.addInitScript(SOM_SAFARI);
  await page.route('**/pdf/pdf.worker*.mjs', async (route) => {
    const svar = await route.fetch();
    await route.fulfill({ response: svar, body: SOM_SAFARI + (await svar.text()) });
  });

  await page.goto('/#kvitton');
  await page.getByTestId('valj-underlag').setInputFiles('e2e/fixtures/faktura.pdf');
  await expect(page.getByTestId('kvitto-besked')).toContainText('sparades');
  await page.getByRole('button', { name: 'Bokför kvittot' }).click();

  await expect(page.getByTestId('anvand-kvittot')).toContainText('500,00', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('ocr-fel')).toBeHidden();
  await page.getByTestId('visa-ocrtext').click();
  await expect(page.getByTestId('ocrtext')).toContainText('ATT BETALA');

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await kontext.close();
});

/*
 * Reading is a convenience. When it fails the person is told why in words
 * they can act on, and the invoice is still the evidence of what is booked.
 */
test('books a PDF invoice whose text could not be read', async ({ browser }) => {
  test.setTimeout(120_000);
  const kontext = await browser.newContext({ serviceWorkers: 'block' });
  const page = await kontext.newPage();
  await page.route('**/pdf/pdf.worker*.mjs', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: 'throw new TypeError("undefined is not a function");',
    }),
  );

  await page.goto('/#kvitton');
  await page.getByTestId('valj-underlag').setInputFiles('e2e/fixtures/faktura.pdf');
  await expect(page.getByTestId('kvitto-besked')).toContainText('sparades');
  await page.getByRole('button', { name: 'Bokför kvittot' }).click();

  await expect(page.getByTestId('ocr-fel')).toContainText(
    'Appen kunde inte läsa texten i PDF:en. Underlaget är sparat',
    { timeout: 60_000 },
  );

  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await page.getByLabel('Att betala').fill('500,00');
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toContainText('A1');

  await page.goto('/#verifikat');
  await page.getByTestId('verifikatlista').getByRole('button', { name: /A1/ }).click();
  await expect(page.locator('[data-testid^="underlag-"]')).toContainText('faktura.pdf');

  await kontext.close();
});

/*
 * The invoice has to be checkable against what is about to be booked, so it
 * opens in full - every page of it, drawn by the app, on a phone that cannot
 * iterate a stream either.
 */
test('shows a PDF invoice in full before it is booked', async ({ browser }) => {
  test.setTimeout(120_000);
  const kontext = await browser.newContext({ serviceWorkers: 'block' });
  const page = await kontext.newPage();
  await page.addInitScript(SOM_SAFARI);
  await page.route('**/pdf/pdf.worker*.mjs', async (route) => {
    const svar = await route.fetch();
    await route.fulfill({ response: svar, body: SOM_SAFARI + (await svar.text()) });
  });

  await page.goto('/#kvitton');
  await page.getByTestId('valj-underlag').setInputFiles('e2e/fixtures/faktura.pdf');
  await expect(page.getByTestId('kvitto-besked')).toContainText('sparades');

  // From the waiting list, where a PDF is only a label until it is opened.
  await page.getByRole('button', { name: 'Visa faktura.pdf' }).click();
  const visning = page.getByTestId('underlagsvisning');
  const sida = visning.getByTestId('pdfsida');
  await expect(sida).toHaveCount(1);

  // Drawn, not just placed: some of the page is darker than paper.
  const morkaPixlar = () =>
    sida.evaluate((canvas: HTMLCanvasElement) => {
      if (canvas.width === 0) {
        return 0;
      }
      const pixlar = canvas
        .getContext('2d')!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let morka = 0;
      for (let i = 0; i < pixlar.length; i += 4) {
        if (pixlar[i]! < 128) {
          morka += 1;
        }
      }
      return morka;
    });
  await expect.poll(morkaPixlar).toBeGreaterThan(100);

  // A tap enlarges it, still drawn, and the page scrolls sideways to read it.
  await visning.getByRole('button', { name: 'Förstora underlaget' }).click();
  const yta = await sida.evaluate((canvas) => canvas.getBoundingClientRect());
  expect(yta.width).toBeGreaterThan(page.viewportSize()!.width * 2);
  expect(yta.height).toBeGreaterThan(yta.width);
  expect(await morkaPixlar()).toBeGreaterThan(100);
  await visning.getByRole('button', { name: 'Stäng' }).click();
  await expect(visning).toBeHidden();

  // And from the booking form, where the figures are checked against it.
  await page.getByRole('button', { name: 'Bokför kvittot' }).click();
  await page.getByRole('button', { name: 'Visa faktura.pdf i full storlek' }).click();
  await expect(visning.getByTestId('pdfsida')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(visning).toBeHidden();

  // The text is read alongside; closing before it has fetched its worker
  // would end the test with a request still running through the route.
  await expect(page.getByTestId('visa-ocrtext')).toBeVisible({ timeout: 60_000 });
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await kontext.close();
});

/*
 * Every study of reading receipts lands on the same conclusion: the input
 * image decides the outcome. The only moment that can be acted on is this one,
 * before the picture is stored and while the receipt is still in the hand.
 */
test('warns about a picture unlikely to be readable', async ({ page }) => {
  await page.goto('/#kvitton');
  await page.getByTestId('valj-underlag').setInputFiles({
    name: 'kvitto.png',
    mimeType: 'image/png',
    buffer: PNG,
  });

  await page.getByTestId('spara-hela').click();
  await expect(page.getByTestId('bildomdome')).toContainText('litet i bild');

  // It warns and does not refuse: a poor photograph beats no photograph.
  await page.getByTestId('spara-hela').click();
  await expect(page.getByTestId('kvitto-besked')).toContainText('sparades');
});

/** Books a purchase with no receipt, the mistake the next tests repair. */
async function bokforUtanKvitto(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await page.getByLabel('Att betala').fill('520,31');
  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toContainText('A1');
}

/*
 * The receipt photographed but forgotten at booking: it waits in Kvitton,
 * and is attached to the booked verifikat afterwards.
 */
test('attaches a waiting receipt to a booked verifikat', async ({ page }) => {
  await bokforUtanKvitto(page);

  await page.goto('/#kvitton');
  await lamnaKvitto(page);
  await expect(page.getByTestId('kvitto-besked')).toContainText('sparades');

  await page.goto('/#verifikat');
  await page.getByTestId('verifikatlista').getByRole('button', { name: /A1/ }).click();
  await page.locator('[data-testid^="lagg-till-underlag-"]').click();
  await page
    .getByTestId('vantande-kvitton')
    .getByRole('button', { name: /Välj kvitto\.jpg/ })
    .click();
  await page.getByTestId('koppla-underlag').click();

  const underlag = page.locator('[data-testid^="underlag-"]');
  await expect(underlag).toContainText('kvitto.jpg');
  await expect(underlag.getByRole('button', { name: 'Öppna' })).toBeVisible();

  // Attached, so it no longer waits.
  await page.goto('/#kvitton');
  await expect(page.getByTestId('inga-kvitton')).toBeVisible();
});

test('photographs a receipt straight onto a booked verifikat', async ({ page }) => {
  await bokforUtanKvitto(page);

  await page.goto('/#verifikat');
  await page.getByTestId('verifikatlista').getByRole('button', { name: /A1/ }).click();
  await page.locator('[data-testid^="lagg-till-underlag-"]').click();
  await page.getByTestId('valj-underlagsfil').setInputFiles({
    name: 'kvitto.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await sparaTrotsOmdome(page);

  await expect(page.getByTestId('valt-for-koppling')).toContainText('kvitto.jpg');
  await page.getByTestId('koppla-underlag').click();

  await expect(page.locator('[data-testid^="underlag-"]')).toContainText('kvitto.jpg');
});
