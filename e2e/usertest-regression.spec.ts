import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { Sakerhetskopia } from '../src/data/backup';

async function plainBackup(page: Page): Promise<Sakerhetskopia> {
  await page.goto('/#sakerhetskopia');
  const pending = page.waitForEvent('download');
  await page.getByTestId('spara-oskyddad').click();
  const d = await pending;
  const file = await d.path();
  if (file === null) throw new Error('Backup download missing');
  await expect(page.getByTestId('datautbyte-besked')).toBeVisible();
  return JSON.parse(await readFile(file, 'utf8')) as Sakerhetskopia;
}
async function book(page: Page) {
  await page.clock.install({ time: new Date('2026-09-20T12:00:00+02:00') });
  await page.clock.resume();
  await page.goto('/#frikontering');
  await page.getByLabel('Datum', { exact: true }).fill('2026-01-02');
  await page.getByLabel('Vad avser det?').fill('Registrerat långt efter affärsdatum');
  await page.getByLabel('Konto, rad 1', { exact: true }).fill('1930');
  await page.getByLabel('Debet, rad 1', { exact: true }).fill('1000');
  await page.getByLabel('Konto, rad 2', { exact: true }).fill('2017');
  await page.getByLabel('Kredit, rad 2', { exact: true }).fill('1000');
  await page.getByTestId('bokfor-fri').click();
  await expect(page.getByTestId('fri-besked')).toContainText('A1');
}

test('a corrupt last file cannot change the book, files or VAT period', async ({
  page,
}) => {
  const before = await plainBackup(page);
  const a = Buffer.from('first receipt');
  const b = Buffer.from('second receipt');
  const file = (data: Buffer) => ({
    sha256: createHash('sha256').update(data).digest('hex'),
    mime: 'application/pdf',
    storlek: data.length,
    data: data.toString('base64'),
  });
  const broken = {
    ...before,
    meta: [
      ...before.meta.filter((m) => m.key !== 'momsperiod'),
      { key: 'momsperiod', value: 'manad', updatedAt: '2026-09-20T10:00:00.000Z' },
    ],
    filer: [file(a), { ...file(b), data: a.toString('base64') }],
  };
  await page.getByTestId('kopiefil').setInputFiles({
    name: 'skadad.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(broken)),
  });
  await expect(page.getByTestId('datautbyte-fel')).toContainText(
    'återställningen avbröts',
  );
  const after = await plainBackup(page);
  expect(after.filer).toEqual(before.filer);
  expect(after.handelser).toEqual(before.handelser);
  expect(after.meta.find((m) => m.key === 'momsperiod')?.value).toBe(
    before.meta.find((m) => m.key === 'momsperiod')?.value,
  );
});

test('a zero-row verification is refused and the existing entry remains', async ({
  page,
}) => {
  await book(page);
  const before = await plainBackup(page);
  const broken = {
    ...before,
    handelser: before.handelser.map((h) =>
      h.typ === 'verifikat.bokfort'
        ? { ...h, verifikat: { ...h.verifikat, konteringar: [] } }
        : h,
    ),
  };
  await page.getByTestId('kopiefil').setInputFiles({
    name: 'tomma-rader.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(broken)),
  });
  await expect(page.getByTestId('datautbyte-fel')).toContainText(
    'minst två konteringsrader',
  );
  const after = await plainBackup(page);
  expect(after.handelser).toEqual(before.handelser);
});

test('SIE keeps the later registration day and both company identity fields', async ({
  page,
}) => {
  await book(page);
  await page.goto('/#bocker');
  await page.getByLabel('Namn', { exact: true }).fill('Testfirman Regression');
  await page.getByRole('button', { name: 'Spara namnet' }).click();
  await expect(page.getByTestId('datautbyte-besked')).toContainText('sparat');
  await page.goto('/#foretag');
  await page.getByLabel('Organisationsnummer').fill('191212121212');
  await page.getByLabel('Organisationsnummer').blur();
  await page.goto('/#filer');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportera 2026 som SIE' }).click();
  const file = await (await pending).path();
  if (file === null) throw new Error('SIE download missing');
  const text = (await readFile(file)).toString('latin1'); // assertions below are ASCII.
  expect(text).toContain('#ORGNR 191212121212');
  expect(text).toContain('#FNAMN "Testfirman Regression"');
  expect(text).toMatch(/#VER "A" 1 20260102 .* 20260920/);
});

test('a fresh restore adopts the backup name immediately', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto('/#bocker');
  await page.getByLabel('Namn', { exact: true }).fill('Testfirman Regression');
  await page.getByRole('button', { name: 'Spara namnet' }).click();
  await expect(page.getByTestId('datautbyte-besked')).toContainText('sparat');
  const copy = await plainBackup(page);
  const context = await browser.newContext();
  try {
    const fresh = await context.newPage();
    await fresh.goto(`${baseURL}/#sakerhetskopia`);
    await fresh.getByTestId('kopiefil').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(copy)),
    });
    await expect(fresh.getByTestId('datautbyte-besked')).toContainText(
      'Boken heter Testfirman Regression',
    );
    await fresh.goto(`${baseURL}/#bocker`);
    await expect(fresh.getByLabel('Namn', { exact: true })).toHaveValue(
      'Testfirman Regression',
    );
    await fresh.goto(`${baseURL}/#sakerhetskopia`);
    const pending = fresh.waitForEvent('download');
    await fresh.getByTestId('spara-oskyddad').click();
    expect((await pending).suggestedFilename()).toMatch(
      /^bokfink-testfirman-regression-/,
    );
  } finally {
    await context.close();
  }
});

for (const [typ, box] of [
  ['eu-tjanst', 21],
  ['eu-vara', 20],
  ['utanfor-eu-tjanst', 22],
] as const) {
  test(`foreign purchase ${typ} keeps the payment and reports both VAT legs`, async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-09-20T12:00:00+02:00') });
    await page.clock.resume();
    await page.goto('/#bokfor');
    await page.getByLabel('Sök', { exact: true }).fill('omvänd');
    await page
      .getByTestId('sokresultat')
      .getByRole('button', { name: /Köp från utlandet/ })
      .click();
    await page.getByLabel('Vad har du köpt?').selectOption(typ);
    await page.getByLabel('Vad avser det?').fill('Testinköp från utlandet');
    await page.getByRole('button', { name: 'Beloppet är i annan valuta' }).click();
    await page.getByLabel('Belopp i valutan, utan moms').fill('100');
    await page.getByLabel('Valuta', { exact: true }).fill('EUR');
    await page.getByLabel('Kurs, kronor per enhet').fill('11');
    await expect(page.getByTestId('granska-utland')).toBeDisabled();
    await page.getByLabel('Fakturan är utan moms och köpet omfattas').check();
    await expect(page.getByTestId('utlandsforslag')).toContainText('1 100,00');
    await expect(page.getByTestId('utlandsforslag')).toContainText('275,00');
    await page.getByTestId('granska-utland').click();
    await expect(page.getByLabel('Debet, rad 1', { exact: true })).toHaveValue('1100,00');
    await expect(page.getByLabel('Kredit, rad 4', { exact: true })).toHaveValue(
      '1100,00',
    );
    await page.getByTestId('bokfor-fri').click();
    await expect(page.getByTestId('fri-besked')).toContainText('A1');
    await page.goto('/#moms');
    await page.getByLabel('Period', { exact: true }).selectOption({ label: '2026 kv 3' });
    const rows = page.getByTestId('momsrutor').getByRole('listitem');
    await expect(
      rows.filter({ hasText: new RegExp(`^Ruta ${box}(?![0-9])`) }),
    ).toContainText('1 100,00');
    for (const n of [30, 48])
      await expect(
        rows.filter({ hasText: new RegExp(`^Ruta ${n}(?![0-9])`) }),
      ).toContainText('275,00');
    await expect(page.getByTestId('momssumma')).toContainText('0,00');
  });
}
