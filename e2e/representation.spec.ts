import { expect, test, type Page } from '@playwright/test';

async function fixeraKlockan(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-09-20T12:00:00+02:00') });
  await page.clock.resume();
}

async function tillRepresentation(page: Page): Promise<void> {
  await page.goto('/#bokfor');
  await page.getByLabel('Sök', { exact: true }).fill('lunch');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Representation/ })
    .click();
}

test('a lunch is divided into the moms that may be deducted and the cost that may not', async ({
  page,
}) => {
  await fixeraKlockan(page);
  await tillRepresentation(page);

  await page.getByLabel('Betalat, med moms').fill('1758');
  await page.getByLabel('Varav moms enligt kvittot').fill('258');
  await page.getByLabel('Antal personer').fill('3');
  await page.getByLabel('Vilka var med?').fill('Anna och Erik, kunder');
  await page.getByLabel('Varför? Vad var syftet?').fill('Genomgång av offert');
  await expect(page.getByTestId('granska-representation')).toBeDisabled();
  await page.getByLabel(/omedelbart samband/).check();

  // Skatteverket's own example: 258 kr of moms in proportion to 900 of 1 500 kr.
  const forslag = page.getByTestId('representationsforslag');
  await expect(forslag).toContainText('154,80');
  await expect(forslag).toContainText('6072');
  await expect(forslag).toContainText('2641');
  await expect(forslag).not.toContainText('6071');
  await expect(forslag).toContainText('NE-bilagans sida 2');

  await page.getByTestId('granska-representation').click();
  await page.getByTestId('bokfor-fri').click();
  await expect(page.getByTestId('fri-besked')).toContainText('A1');

  // The moms goes to field 48, and who took part and why stays on the verifikat.
  await page.goto('/#moms');
  await page.getByLabel('Period', { exact: true }).selectOption({ label: '2026 kv 3' });
  const rader = page.getByTestId('momsrutor').getByRole('listitem');
  await expect(rader.filter({ hasText: /^Ruta 48(?![0-9])/ })).toContainText('154,80');
  await page.goto('/#verifikat');
  await expect(page.getByText(/Anna och Erik, kunder/)).toBeVisible();
  await expect(page.getByText(/Syfte: Genomgång av offert/)).toBeVisible();
});

test('asks who was there and why before it will propose anything', async ({ page }) => {
  await fixeraKlockan(page);
  await tillRepresentation(page);
  await page.getByLabel('Betalat, med moms').fill('500');
  await page.getByLabel('Varav moms enligt kvittot').fill('60');
  await page.getByLabel('Antal personer').fill('2');
  await expect(page.getByTestId('representationshinder')).toContainText(
    'Skriv vilka som var med',
  );
  await expect(page.getByTestId('representationsforslag')).toHaveCount(0);
  await page.getByLabel('Vilka var med?').fill('Kund');
  await expect(page.getByTestId('representationshinder')).toContainText('syfte');
});

test('a gift over 300 kr is only partly deductible', async ({ page }) => {
  await fixeraKlockan(page);
  await tillRepresentation(page);
  await page.getByRole('button', { name: 'Gåva till kund' }).click();
  await page.getByLabel('Betalat, med moms').fill('650');
  await page.getByLabel('Varav moms enligt kvittot').fill('130');
  await page.getByLabel('Antal gåvor').fill('1');
  await page.getByLabel('Vem fick gåvan?').fill('Blommor till kunds jubileum');
  await page.getByLabel('Varför? Vad var syftet?').fill('Jubileum');
  const forslag = page.getByTestId('representationsforslag');
  await expect(forslag).toContainText('75,00');
  await expect(forslag).toContainText('6071');
  await expect(forslag).toContainText('300,00');
  await expect(forslag).toContainText('275,00');
});

test('representation is one of the answers under Pengar ut', async ({ page }) => {
  await page.goto('/#bokfor');
  await page.getByTestId('svar').getByRole('button', { name: 'Pengar ut' }).click();
  await page
    .getByTestId('svar')
    .getByRole('button', { name: /Representation, fika eller gåva/ })
    .click();
  await page.getByTestId('hanvisning-representation').click();
  await expect(page.getByRole('heading', { name: 'Representation' })).toBeVisible();
});

test('a construction service with reverse charge is reported in fields 24, 30 and 48', async ({
  page,
}) => {
  await fixeraKlockan(page);
  await page.goto('/#bokfor');
  await page.getByLabel('Sök', { exact: true }).fill('underentreprenör');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Köp med omvänd moms/ })
    .click();
  await page
    .getByLabel('Vad har du köpt?')
    .selectOption({ label: 'Byggtjänst från underentreprenör i Sverige' });
  await expect(page.getByTestId('bygghjalp')).toContainText(
    'omvänd betalningsskyldighet',
  );
  // No currency to choose for a purchase made in Sweden.
  await expect(
    page.getByRole('button', { name: 'Beloppet är i annan valuta' }),
  ).toHaveCount(0);
  await page.getByLabel('Vad avser det?').fill('Plattsättning badrum');
  await page.getByLabel('Belopp i kronor, utan moms').fill('10000');
  await page.getByLabel(/omvänd betalningsskyldighet, och momsen dras av helt/).check();
  const forslag = page.getByTestId('utlandsforslag');
  await expect(forslag).toContainText('4425');
  await expect(forslag).toContainText('2647');
  await expect(forslag).toContainText('2614');
  await page.getByTestId('granska-utland').click();
  await page.getByTestId('bokfor-fri').click();
  await expect(page.getByTestId('fri-besked')).toContainText('A1');

  await page.goto('/#moms');
  await page.getByLabel('Period', { exact: true }).selectOption({ label: '2026 kv 3' });
  const rader = page.getByTestId('momsrutor').getByRole('listitem');
  await expect(rader.filter({ hasText: /^Ruta 24(?![0-9])/ })).toContainText('10 000,00');
  await expect(rader.filter({ hasText: /^Ruta 30(?![0-9])/ })).toContainText('2 500,00');
  await expect(rader.filter({ hasText: /^Ruta 48(?![0-9])/ })).toContainText('2 500,00');
  await expect(page.getByTestId('momssumma')).toContainText('0,00');
});
