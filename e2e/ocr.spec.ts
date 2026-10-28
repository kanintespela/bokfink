import { expect, test, type Page } from '@playwright/test';

/*
 * Recognising a receipt means fetching and compiling several megabytes of
 * wasm and then reading an image, which is slow on a small machine and slow
 * in CI. It is worth the wait: this is the only test that proves the engine
 * is actually wired to our own origin rather than reaching for a CDN.
 */
test.setTimeout(180_000);

/**
 * Paints a receipt in the page and hands it to the file input.
 *
 * Drawn rather than committed as a fixture: a PNG of text in the repository
 * would be a binary nobody can review, and what is being tested is that the
 * words on a receipt come back, not that one particular photograph does.
 */
const KVITTORADER = [
  'Lantbruk AB',
  '2026-02-13',
  'Kraftfoder 25 kg',
  'Att betala 520,31',
  'Moms 25% 104,06',
];

async function lamnaKvitto(
  page: Page,
  falt = 'valj-underlag',
  vridning = 0,
  rader: readonly string[] = KVITTORADER,
): Promise<void> {
  // The database is read before the view renders, so the field is not there
  // the moment the page answers.
  await page.getByTestId(falt).waitFor({ state: 'attached' });

  await page.evaluate(
    async ({ testid, grader, rader }) => {
      // Large enough to pass the quality check, which a real photograph is.
      const bredd = 1400;
      const hojd = 900;
      const duk = document.createElement('canvas');
      duk.width = grader === 0 ? bredd : hojd;
      duk.height = grader === 0 ? hojd : bredd;
      const ritare = duk.getContext('2d');
      if (ritare === null) {
        throw new Error('ingen canvas');
      }
      ritare.fillStyle = '#ffffff';
      ritare.fillRect(0, 0, duk.width, duk.height);
      if (grader !== 0) {
        // Laid across the frame, the way a long receipt is photographed.
        ritare.translate(duk.width, 0);
        ritare.rotate(Math.PI / 2);
      }
      ritare.fillStyle = '#000000';
      ritare.font = '52px sans-serif';
      for (const [rad, text] of rader.entries()) {
        ritare.fillText(text, 60, 130 + rad * 140);
      }

      const blob = await new Promise<Blob | null>((klar) =>
        duk.toBlob(klar, 'image/png'),
      );
      if (blob === null) {
        throw new Error('ingen bild');
      }

      const overforing = new DataTransfer();
      overforing.items.add(new File([blob], 'kvitto.png', { type: 'image/png' }));
      const falt = document.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`);
      if (falt === null) {
        throw new Error('inget filfält');
      }
      falt.files = overforing.files;
      falt.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { testid: falt, grader: vridning, rader },
  );
}

/** Keeps the whole picture, which is what a rendered receipt needs. */
async function sparaHela(page: Page): Promise<void> {
  await page.getByTestId('spara-hela').click();
}

test('reads a receipt and offers what it says', async ({ page }) => {
  await page.goto('/#kvitton');
  await lamnaKvitto(page);
  await sparaHela(page);
  await expect(page.getByTestId('kvitto-besked')).toContainText('sparades');

  await page.getByRole('button', { name: 'Bokför kvittot' }).click();

  // Offered, never filled in by itself: hard rule 10 keeps the person in it.
  const erbjudande = page.getByTestId('anvand-kvittot');
  await expect(erbjudande).toBeVisible({ timeout: 150_000 });
  await expect(erbjudande).toContainText('520,31');
  await expect(erbjudande).toContainText('2026-02-13');

  // The receipt says "Kraftfoder", which is a word the feed answer knows,
  // so the offer picks what it is too and one tap fills the whole form.
  await expect(erbjudande).toContainText('Foder och strö');

  await erbjudande.click();
  await expect(page.getByLabel('Att betala')).toHaveValue('520,31');
  await expect(page.getByLabel('Datum')).toHaveValue('2026-02-13');
});

/*
 * The other direction, and the one that fits a purchase made at a counter:
 * say what it was, photograph the receipt, accept what it read, book. The
 * form must survive the camera and the crop with what is already typed
 * intact - that is what makes this an addition to the flow rather than a
 * restart of it.
 */
test('photographs the receipt from inside the booking form', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Vyer' })
    .getByRole('button', { name: 'Bokför', exact: true })
    .click();

  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await page.getByLabel('Vad avser det?').fill('Foder från Lantbruk AB');

  // The crop step is the same one the Kvitton screen shows, and it is tested
  // there; here the whole picture is kept.
  await lamnaKvitto(page, 'fotografera-underlag');
  await sparaHela(page);

  // What was typed before the camera is still there afterwards.
  await expect(page.getByLabel('Vad avser det?')).toHaveValue('Foder från Lantbruk AB');
  await expect(page.getByTestId('valt-underlag')).toBeVisible();

  const erbjudande = page.getByTestId('anvand-kvittot');
  await expect(erbjudande).toBeVisible({ timeout: 150_000 });
  await expect(erbjudande).toContainText('520,31');

  await erbjudande.click();
  await expect(page.getByLabel('Att betala')).toHaveValue('520,31');

  // What it read is available on request, so a wrong suggestion can be
  // explained rather than only reported.
  await page.getByTestId('visa-ocrtext').click();
  await expect(page.getByTestId('ocrtext')).toContainText('Kraftfoder');

  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toContainText('A1');

  // Booked with its evidence attached, and nothing left waiting.
  await page.goto('/#verifikat');
  await page.getByTestId('verifikatlista').getByRole('button', { name: /A1/ }).click();
  const underlag = page.locator('[data-testid^="underlag-"]');
  await expect(underlag).toContainText('kvitto.jpg');
  // The evidence is openable, not just named.
  await expect(underlag.getByRole('button', { name: 'Öppna' })).toBeVisible();

  await page.goto('/#kvitton');
  await expect(page.getByTestId('inga-kvitton')).toBeVisible();
});

/*
 * A receipt is long and thin, so it gets photographed lying across the frame -
 * and OCR reads horizontal text only. Measured before this was built: the same
 * five lines read cleanly upright and came back as "= I Oo Zz" on their side.
 * Turning is therefore not a nicety, it is the difference between a suggestion
 * and gibberish.
 */
test('reads a receipt photographed on its side once it is turned', async ({ page }) => {
  await page.goto('/#kvitton');
  await lamnaKvitto(page, 'valj-underlag', 90);

  // Three quarter turns back the way it came.
  const vrid = page.getByTestId('vrid');
  await vrid.click();
  await vrid.click();
  await vrid.click();
  await sparaHela(page);

  await page.getByRole('button', { name: 'Bokför kvittot' }).click();

  const erbjudande = page.getByTestId('anvand-kvittot');
  await expect(erbjudande).toBeVisible({ timeout: 150_000 });
  await expect(erbjudande).toContainText('520,31');
});

/*
 * A shop computes VAT per line and sums; 25 % of the total lands an öre away.
 * The receipt wins, because what may be deducted as ingående moms is what the
 * seller charged - and the verifikat then agrees with the underlag line for
 * line, which is what a granskare compares.
 *
 * The figures are from a real shoe shop receipt: 1 004,00 paid, 200,81 of VAT
 * where the arithmetic on the total gives 200,80.
 */
test('books the VAT the receipt states, not the one it computes', async ({ page }) => {
  await page.goto('/#kvitton');
  await lamnaKvitto(page, 'valj-underlag', 0, [
    'Exempelskor AB',
    '2026-05-09',
    'Totalt 1 004,00 kr',
    'Moms 25% (803,19 kr) 200,81 kr',
  ]);
  await sparaHela(page);

  await page.getByRole('button', { name: 'Bokför kvittot' }).click();
  const erbjudande = page.getByTestId('anvand-kvittot');
  await expect(erbjudande).toBeVisible({ timeout: 150_000 });

  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await erbjudande.click();

  await expect(page.getByTestId('momsdelning')).toContainText('200,81');
  await expect(page.getByTestId('momsdelning')).toContainText('803,19');
  await expect(page.getByTestId('momsdelning')).toContainText('från underlaget');

  await page.getByRole('button', { name: 'Visa konteringen' }).click();
  const kontering = page.getByTestId('kontering');
  await expect(kontering).toContainText('803,19');
  await expect(kontering).toContainText('200,81');
});

/*
 * A zero VAT against a leaf that says 25 % is a misread, and the booking it
 * produces looks finished: the right total, the right date, the right
 * account, and not an öre deducted as ingående moms. Hard rule 11 - the form
 * says so, and offers the arithmetic instead.
 */
test('says so when the underlag states no VAT and the leaf says there is', async ({
  page,
}) => {
  await page.goto('/#kvitton');
  await lamnaKvitto(page, 'valj-underlag', 0, [
    'Swecol AB',
    '2026-09-16',
    'Att betala 3 225,00',
    'Varav moms: 0,00',
  ]);
  await sparaHela(page);

  await page.getByRole('button', { name: 'Bokför kvittot' }).click();
  const erbjudande = page.getByTestId('anvand-kvittot');
  await expect(erbjudande).toBeVisible({ timeout: 150_000 });

  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await erbjudande.click();

  const besked = page.getByTestId('momsdelning-noll');
  await expect(besked).toContainText('0 kr moms');
  await expect(besked).toContainText('3 225,00');

  // The repair: drop what the underlag said and use the leaf's rate.
  await page.getByTestId('rakna-ut-momsen').click();
  await expect(besked).toBeHidden();
  await expect(page.getByTestId('momsdelning')).toContainText('645,00');
  await expect(page.getByTestId('momsdelning')).toContainText('2 580,00');
});

/*
 * A date that was not read leaves today standing in the field, and today
 * looks exactly like an answer. On a receipt photographed weeks after the
 * purchase that is the wrong month - and the wrong month is the wrong
 * momsdeklaration.
 */
test('says so when it could not read the date', async ({ page }) => {
  await page.goto('/#kvitton');
  await lamnaKvitto(page, 'valj-underlag', 0, [
    'Hastsport AB',
    'Att betala 957,50',
    'Kort 957,50',
  ]);
  await sparaHela(page);

  await page.getByRole('button', { name: 'Bokför kvittot' }).click();
  const erbjudande = page.getByTestId('anvand-kvittot');
  await expect(erbjudande).toBeVisible({ timeout: 150_000 });
  // No date is offered, because none was found.
  await expect(erbjudande).not.toContainText(' den ');

  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await expect(page.getByTestId('datum-olast')).toBeVisible();
});
