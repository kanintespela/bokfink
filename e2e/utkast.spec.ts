import { createHash } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * A one-pixel PNG, standing in for a photographed receipt.
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const UNDERLAG = '01990000-0000-7000-8000-000000000001';
const UTKAST = '01990000-0000-7000-8000-000000000002';

/**
 * A draft with its receipt, arriving the way one from another device does:
 * as entries in the log, with the file beside them.
 *
 * Read in through a backup rather than through the sync, which needs a
 * server. It is the same log either way, and what is being tested is what
 * the app does with a draft once it has one. The date is today, so it falls
 * in the year the app creates when it starts.
 */
async function lasInUtkast(page: Page): Promise<void> {
  const idag = new Date().toISOString().slice(0, 10);
  const huvud = (id: string) => ({
    id,
    enhet: 'claude-pi',
    tidpunkt: `${idag}T08:00:00.000Z`,
  });
  const kopia = {
    format: 'kontera-backup',
    formatversion: 2,
    schemaversion: 1,
    skapad: `${idag}T08:00:00.000Z`,
    meta: [],
    handelser: [
      {
        ...huvud(UNDERLAG),
        typ: 'underlag.tillagt',
        underlag: {
          id: UNDERLAG,
          sha256: createHash('sha256').update(PNG).digest('hex'),
          mime: 'image/png',
          storlek: PNG.byteLength,
          filnamn: 'kvitto-foder.png',
          tillagd: `${idag}T08:00:00.000Z`,
          verifikat: [],
        },
      },
      {
        ...huvud(UTKAST),
        typ: 'utkast.sparat',
        utkast: {
          status: 'utkast',
          id: UTKAST,
          datum: idag,
          beskrivning: 'Foder, Lantmännen',
          konteringar: [
            { konto: '4000', belopp: 40000 },
            { konto: '2641', belopp: 10000 },
            { konto: '2017', belopp: -50000 },
          ],
        },
      },
      {
        ...huvud('01990000-0000-7000-8000-000000000003'),
        typ: 'underlag.kopplat',
        underlagId: UNDERLAG,
        verifikatId: UTKAST,
      },
    ],
    filer: [
      {
        sha256: createHash('sha256').update(PNG).digest('hex'),
        mime: 'image/png',
        storlek: PNG.byteLength,
        data: PNG.toString('base64'),
      },
    ],
  };

  await page.goto('/#sakerhetskopia');
  await page.getByTestId('kopiefil').setInputFiles({
    name: 'utkast.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(kopia), 'utf8'),
  });
  await expect(page.getByTestId('datautbyte-besked')).toBeVisible();
}

/*
 * Hard rule 10 from the receiving end: a draft written somewhere else is
 * shown with its receipt and its accounts, and becomes bookkeeping only when
 * the button is pressed here.
 */
test('books a draft with its receipt attached', async ({ page }) => {
  await lasInUtkast(page);

  await page.goto('/');
  await page.getByTestId('utkast-vantar').click();

  const utkast = page.getByTestId(`utkast-${UTKAST}`);
  await expect(utkast).toContainText('Foder, Lantmännen');
  await expect(
    utkast.getByRole('img', { name: 'Underlag kvitto-foder.png' }),
  ).toBeVisible();
  await expect(page.getByTestId(`utkast-kontering-${UTKAST}`)).toContainText('4000');
  await expect(page.getByTestId(`utkast-kontering-${UTKAST}`)).toContainText('400,00');

  await page.getByTestId(`bokfor-utkast-${UTKAST}`).click();

  await expect(page.getByTestId('utkast-besked')).toContainText('Bokfört som A1.');
  await expect(page.getByTestId('inga-utkast')).toBeVisible();

  // The receipt came along: it is the booked verifikat's evidence now.
  await page.goto('/#verifikat');
  await page.getByTestId('verifikatlista').getByRole('button', { name: /A1/ }).click();
  await expect(page.getByTestId(`underlag-${UTKAST}`)).toContainText('kvitto-foder.png');
});

test('sends the receipt back to wait when a draft is thrown away', async ({ page }) => {
  await lasInUtkast(page);

  await page.goto('/#utkast');
  await page.getByTestId(`kassera-${UTKAST}`).click();
  await page.getByTestId(`bekrafta-kassera-${UTKAST}`).click();

  await expect(page.getByTestId('inga-utkast')).toBeVisible();

  await page.goto('/#kvitton');
  await expect(page.getByTestId('kvittolista').getByRole('listitem')).toHaveCount(1);
});
