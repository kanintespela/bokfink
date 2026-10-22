import { expect, test } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * An invoice with a real text layer, made here so the test shows what it says.
 * Labels over values, the way most invoice headers are laid out.
 */
async function faktura(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const sida = pdf.addPage([595, 842]);
  const typsnitt = await pdf.embedFont(StandardFonts.Helvetica);
  const rader: [string, number, number][] = [
    ['Lantbrukstjanst i Ekeby AB', 50, 780],
    ['Fakturadatum', 50, 740],
    ['Forfallodatum', 200, 740],
    ['2026-09-20', 50, 725],
    ['2026-10-20', 200, 725],
    ['ATT BETALA', 50, 680],
    ['1 230,00', 200, 680],
  ];
  for (const [text, x, y] of rader) {
    sida.drawText(text, { x, y, size: 11, font: typsnitt });
  }
  return Buffer.from(await pdf.save());
}

test('reminds of an invoice once its due date is saved', async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install({ time: new Date('2026-10-04T10:00:00+02:00') });
  await page.clock.resume();

  await page.goto('/#kvitton');
  await page.getByTestId('valj-underlag').setInputFiles({
    name: 'faktura.pdf',
    mimeType: 'application/pdf',
    buffer: await faktura(),
  });
  await expect(page.getByTestId('kvitto-besked')).toContainText('sparades');

  await page.getByRole('button', { name: 'Ange förfallodag' }).click();
  await page.getByRole('button', { name: 'Läs förfallodagen ur underlaget' }).click();
  await expect(page.getByTestId('forfallodag-forslag')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel('Förfallodag')).toHaveValue('2026-10-20');

  await page.getByRole('button', { name: 'Spara' }).click();
  await expect(
    page.getByRole('button', { name: 'Betalas senast 2026-10-20' }),
  ).toBeVisible();

  await page.goto('/');
  const kort = page.getByTestId('faktura-forfaller');
  await expect(kort).toContainText('ska betalas senast 2026-10-20, om 16 dagar');
  await expect(kort).toContainText('Lantbrukstjanst i Ekeby AB');
});
