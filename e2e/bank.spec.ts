import { expect, test, type Page } from '@playwright/test';

/**
 * A statement in the shape a Swedish bank exports: semicolons, decimal comma,
 * spaces for thousands, newest line first, and account details above the
 * header.
 */
const UTDRAG = `Kontonummer;123 456 789-0
Period;2026-02-01 - 2026-02-28

Bokföringsdag;Referens;Beskrivning;Belopp;Bokfört saldo
2026-02-14;Kortköp;BYGGHANDEL EXEMPEL;-520,31;12 345,67
2026-02-10;Inbetalning;FAKTURA 4417;12 645,00;12 865,98
`;

async function lasUtdrag(page: Page): Promise<void> {
  await page.getByTestId('valj-kontoutdrag').setInputFiles({
    name: 'kontoutdrag.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(UTDRAG, 'utf-8'),
  });
}

/*
 * The question the import answers: what have I forgotten? Nothing is booked
 * from the file itself - a missing line becomes a filled-in form that the
 * person approves, which is hard rule 10 and also the only way the account
 * and the VAT rate get chosen by someone who knows what the purchase was.
 */
test('shows which statement lines are missing from the books', async ({ page }) => {
  await page.goto('/#bank');
  await lasUtdrag(page);

  await expect(page.getByTestId('bank-sammanfattning')).toContainText('2 rader lästes');
  await expect(page.getByTestId('bank-sammanfattning')).toContainText('2 saknas');
  await expect(page.getByTestId('saknade-rader').getByRole('listitem')).toHaveCount(2);
});

test('books a missing line and stops reporting it', async ({ page }) => {
  await page.goto('/#bank');
  await lasUtdrag(page);

  await page.getByRole('button', { name: /BYGGHANDEL EXEMPEL/ }).click();

  // The line fills the form the way a receipt does, and the money came from
  // the company account because that is whose statement it is.
  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await page.getByTestId('anvand-kvittot').click();
  await expect(page.getByLabel('Att betala')).toHaveValue('520,31');
  await expect(page.getByLabel('Datum')).toHaveValue('2026-02-14');
  await expect(page.getByRole('button', { name: 'Företagskontot' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toContainText('A1');

  /*
   * Reloaded, so the statement is matched against the books as stored. The
   * number shows before the screen has re-read the ledger, and moving on in
   * that moment matched against the list from before the booking.
   */
  await page.goto('/#bank');
  await page.reload();
  await lasUtdrag(page);
  await expect(page.getByTestId('bank-sammanfattning')).toContainText('1 saknas');
});

test('says what it could not read rather than importing nothing', async ({ page }) => {
  await page.goto('/#bank');
  await page.getByTestId('valj-kontoutdrag').setInputFiles({
    name: 'fel.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('a;b;c\n1;2;3\n', 'utf-8'),
  });

  await expect(page.getByTestId('bank-fel')).toContainText('datum, text och belopp');
});
