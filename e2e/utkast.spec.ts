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
      // A year and the draft's accounts, since a book that brings its own
      // replaces the starter set a new app makes.
      {
        ...huvud('01980000-0000-7000-8000-0000000000aa'),
        typ: 'rakenskapsar.skapat',
        rakenskapsar: {
          id: '01980000-0000-7000-8000-0000000000ab',
          start: `${idag.slice(0, 4)}-01-01`,
          slut: `${idag.slice(0, 4)}-12-31`,
          avslutat: false,
          ingaendeBalanser: [],
        },
      },
      ...(
        [
          ['4000', 'Varor', 'kostnad'],
          ['2641', 'Debiterad ingående moms', 'skuld'],
          ['2017', 'Egen insättning', 'egetKapital'],
          ['2013', 'Övriga egna uttag', 'egetKapital'],
        ] as const
      ).map(([nummer, namn, typ], index) => ({
        ...huvud(`01980000-0000-7000-8000-00000000000${index}`),
        typ: 'konto.skapat',
        konto: { nummer, namn, typ, aktiv: true, favorit: false, sru: [] },
      })),
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
          motivering: 'Kraftfoder till fåren, som de tidigare köpen hos Lantmännen.',
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
  await page.getByTestId('att-bokfora-vantar').click();

  const utkast = page.getByTestId(`utkast-${UTKAST}`);
  await expect(utkast).toContainText('Foder, Lantmännen');
  await expect(
    utkast.getByRole('img', { name: 'Underlag kvitto-foder.png' }),
  ).toBeVisible();
  await expect(page.getByTestId(`utkast-motivering-${UTKAST}`)).toContainText(
    'som de tidigare köpen hos Lantmännen',
  );
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

/*
 * A suggestion that is nearly right is changed, not thrown away: here the
 * payment came from the private account, not the one the reader guessed.
 * The draft keeps its receipt and its reasons, and books as changed.
 */
test('changes a draft before booking it', async ({ page }) => {
  await lasInUtkast(page);

  await page.goto('/#kvitton');
  await page.getByTestId(`andra-utkast-${UTKAST}`).click();
  await expect(page.getByRole('heading', { name: 'Ändra utkastet' })).toBeVisible();
  await page.getByLabel('Konto, rad 3').fill('2013');
  await page.getByTestId('bokfor-fri').click();

  await expect(page.getByTestId(`utkast-kontering-${UTKAST}`)).toContainText('2013');
  await expect(page.getByTestId(`utkast-kontering-${UTKAST}`)).not.toContainText('2017');
  await expect(page.getByTestId(`utkast-motivering-${UTKAST}`)).toBeVisible();

  await page.getByTestId(`bokfor-utkast-${UTKAST}`).click();
  await expect(page.getByTestId('utkast-besked')).toContainText('Bokfört som A1.');
  await page.goto('/#verifikat');
  await page.getByTestId('verifikatlista').getByRole('button', { name: /A1/ }).click();
  await expect(page.locator('[data-testid^="kontering-"]')).toContainText('2013');
  await expect(page.getByTestId(`underlag-${UTKAST}`)).toContainText('kvitto-foder.png');
});

/*
 * Photographed in books where the assistant has been at work: the receipt
 * says the assistant is reading it, and booking it by hand is offered as the
 * alternative rather than the next step - pressed at once, it would start the
 * phone's own, weaker reading and race the draft on its way.
 */
test('says the assistant is reading a receipt just photographed', async ({ page }) => {
  await lasInUtkast(page);

  await page.goto('/#kvitton');
  await page.getByTestId('valj-underlag').setInputFiles({
    name: 'nytt-kvitto.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAAAAABX3VL4AAAADklEQVQI12P8wMDEwAAABMIA9OHnekkAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  const spara = page.getByTestId('spara-hela');
  await spara.click();
  if (
    await page
      .getByTestId('bildomdome')
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false)
  ) {
    await spara.click();
  }

  const lista = page.getByTestId('kvittolista');
  await expect(lista.locator('[data-testid^="assistenten-laser-"]')).toContainText(
    'Assistenten läser kvittot',
  );
  await expect(
    lista.getByRole('button', { name: 'Bokför själv i stället' }),
  ).toBeVisible();
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
