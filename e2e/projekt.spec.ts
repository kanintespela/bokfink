import { expect, test, type Page } from '@playwright/test';

async function oppnaProjekt(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Vyer' })
    .getByRole('button', { name: 'Mer' })
    .click();
  await page.getByRole('button', { name: 'Projekt', exact: true }).click();
}

test('creates a project, renames it, finishes it and opens it again', async ({
  page,
}) => {
  await oppnaProjekt(page);
  await expect(page.getByTestId('inga-projekt')).toBeVisible();

  await page.getByLabel('Kod').fill('LEADER-28');
  await page.getByLabel('Namn', { exact: true }).fill('Ny scen');
  await page.getByTestId('skapa-projekt').click();
  await expect(page.getByTestId('projektlista')).toContainText('LEADER-28 Ny scen');
  await expect(page.getByTestId('projektlista')).toContainText('Pågår');

  // The same code in other letters is the same project.
  await page.getByLabel('Kod').fill('leader-28');
  await page.getByLabel('Namn', { exact: true }).fill('Dubblett');
  await page.getByTestId('skapa-projekt').click();
  await expect(page.getByRole('alert')).toContainText('finns redan ett projekt');

  await page.getByTestId('byt-namn-LEADER-28').click();
  await page.getByLabel('Nytt namn för LEADER-28').fill('Ny scen vid badplatsen');
  await page.getByTestId('spara-projektnamn').click();
  await expect(page.getByTestId('projektlista')).toContainText(
    'LEADER-28 Ny scen vid badplatsen',
  );

  await page.getByTestId('avsluta-LEADER-28').click();
  await expect(page.getByTestId('projektlista')).toContainText('Avslutat');
  await page.getByTestId('oppna-LEADER-28').click();
  await expect(page.getByTestId('projektlista')).toContainText('Pågår');

  // It is still there after a reload: a post of the log, not of the screen.
  await oppnaProjekt(page);
  await expect(page.getByTestId('projektlista')).toContainText('LEADER-28');
});

test('books a rad on a project with Fri kontering and shows it on the verifikat', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-04-05T10:00:00+02:00') });
  await page.clock.resume();

  await oppnaProjekt(page);
  await page.getByLabel('Kod').fill('LEADER-28');
  await page.getByLabel('Namn', { exact: true }).fill('Ny scen');
  await page.getByTestId('skapa-projekt').click();
  await expect(page.getByTestId('projektlista')).toContainText('LEADER-28');

  await page.goto('/#frikontering');
  await page.getByLabel('Vad avser det?').fill('Virke till scenen');
  await page.getByLabel('Konto, rad 1').fill('6100');
  await page.getByLabel('Debet, rad 1').fill('100');
  await page.getByLabel('Projekt, rad 1').selectOption({ label: 'LEADER-28 Ny scen' });
  await page.getByLabel('Konto, rad 2').fill('1930');
  await page.getByLabel('Kredit, rad 2').fill('100');
  // The bank row is not a cost of the project and says nothing of it.
  await page.getByTestId('bokfor-fri').click();
  await expect(page.getByTestId('fri-besked')).toContainText('A1');

  await page.goto('/#verifikat');
  await page.getByTestId('verifikatlista').getByRole('button', { name: /A1/ }).click();
  const rader = page.getByTestId(/^kontering-/).getByRole('listitem');
  await expect(rader.nth(0)).toContainText('LEADER-28');
  await expect(rader.nth(1)).not.toContainText('LEADER-28');
});

test('does not offer the field while there is no project', async ({ page }) => {
  await page.goto('/#frikontering');
  await expect(page.getByLabel('Konto, rad 1')).toBeVisible();
  await expect(page.getByLabel('Projekt, rad 1')).toHaveCount(0);
});

test('puts the cost row of a guided booking on a project, and not the payment or the moms', async ({
  page,
}) => {
  await oppnaProjekt(page);
  await page.getByLabel('Kod').fill('LEADER-28');
  await page.getByLabel('Namn', { exact: true }).fill('Ny scen');
  await page.getByTestId('skapa-projekt').click();
  await expect(page.getByTestId('projektlista')).toContainText('LEADER-28');

  await page.goto('/#bokfor');
  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await page.getByLabel('Att betala').fill('1000');
  await page
    .getByLabel('Projekt (kostnaden)')
    .selectOption({ label: 'LEADER-28 Ny scen' });

  await page.getByRole('button', { name: 'Visa konteringen' }).click();
  const kontering = page.getByTestId('kontering').getByRole('listitem');
  await expect(kontering).toHaveCount(3);
  await expect(kontering.nth(0)).toContainText('LEADER-28');
  await expect(kontering.nth(1)).not.toContainText('LEADER-28');
  await expect(kontering.nth(2)).not.toContainText('LEADER-28');

  await page.locator('main').getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('senast-bokfort')).toContainText('A1');

  // The field starts over for the next entry rather than carrying the project on.
  await page.getByLabel('Sök').fill('foder');
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: /Foder och strö/ })
    .click();
  await expect(page.getByLabel('Projekt (kostnaden)')).toHaveValue('');
});

test('takes up a year-end item on a project, the reversal included', async ({ page }) => {
  // The project is made in the year being closed; the item is taken up in January.
  await page.clock.install({ time: new Date('2026-12-20T10:00:00+01:00') });
  await page.clock.resume();

  await oppnaProjekt(page);
  await page.getByLabel('Kod').fill('LEADER-28');
  await page.getByLabel('Namn', { exact: true }).fill('Ny scen');
  await page.getByTestId('skapa-projekt').click();
  await expect(page.getByTestId('projektlista')).toContainText('LEADER-28');

  await page.clock.setSystemTime(new Date('2027-01-20T10:00:00+01:00'));
  await page.goto('/#periodisering');
  await page.reload();
  await page
    .getByLabel('Vad gäller det?')
    .selectOption({ label: 'Förskott till leverantör' });
  await page.getByLabel('Beskrivning').fill('Handpenning, ny scen');
  await page.getByLabel('Belopp utan moms').fill('8000');
  await page.getByLabel('Projekt').selectOption({ label: 'LEADER-28 Ny scen' });
  await expect(page.getByTestId('bokslutspost-forslag')).toContainText('LEADER-28');
  await page.getByTestId('bokfor-bokslutspost').click();
  await expect(page.getByTestId('bokslutspost-besked')).toContainText('tillbakafört');

  await page.goto('/#verifikat');
  await page.getByTestId('verifikatlista').getByRole('button', { name: /A1/ }).click();
  await expect(page.getByTestId(/^kontering-/).first()).toContainText('LEADER-28');
});

test('corrects the project of a booked rad and keeps what it was beside it', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-04-05T10:00:00+02:00') });
  await page.clock.resume();

  await oppnaProjekt(page);
  await page.getByLabel('Kod').fill('LEADER-28');
  await page.getByLabel('Namn', { exact: true }).fill('Ny scen');
  await page.getByTestId('skapa-projekt').click();
  await expect(page.getByTestId('projektlista')).toContainText('LEADER-28');
  await page.getByLabel('Kod').fill('FEST-26');
  await page.getByLabel('Namn', { exact: true }).fill('Sommarfest');
  await page.getByTestId('skapa-projekt').click();
  await expect(page.getByTestId('projektlista')).toContainText('FEST-26');

  // Booked with no project at all.
  await page.goto('/#frikontering');
  await page.getByLabel('Vad avser det?').fill('Virke till scenen');
  await page.getByLabel('Konto, rad 1').fill('6100');
  await page.getByLabel('Debet, rad 1').fill('100');
  await page.getByLabel('Konto, rad 2').fill('1930');
  await page.getByLabel('Kredit, rad 2').fill('100');
  await page.getByTestId('bokfor-fri').click();
  await expect(page.getByTestId('fri-besked')).toContainText('A1');

  await page.goto('/#verifikat');
  await page.getByTestId('verifikatlista').getByRole('button', { name: /A1/ }).click();
  await page.getByTestId(/^ratta-/).click();
  await page.getByLabel(/^Projekt, rad 1/).selectOption({ label: 'LEADER-28 Ny scen' });
  await page.getByTestId(/^spara-rattelse-/).click();

  const rader = page.getByTestId(/^kontering-/).getByRole('listitem');
  await expect(rader.nth(0)).toContainText('LEADER-28');
  await expect(rader.nth(1)).not.toContainText('LEADER-28');
  await expect(page.getByTestId(/^rattelser-/)).toContainText('Projekt på rad 1 rättad');
  await expect(page.getByTestId(/^rattelser-/)).toContainText(
    'inget projekt → LEADER-28',
  );

  // Moved to the other project, and the first correction stays beside the second.
  await page.getByTestId(/^ratta-/).click();
  await page.getByLabel(/^Projekt, rad 1/).selectOption({ label: 'FEST-26 Sommarfest' });
  await page.getByTestId(/^spara-rattelse-/).click();
  await expect(rader.nth(0)).toContainText('FEST-26');
  await expect(page.getByTestId(/^rattelser-/).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByTestId(/^rattelser-/)).toContainText('LEADER-28 → FEST-26');

  // The money did not move.
  await expect(rader.nth(0)).toContainText('100,00');
  await expect(rader.nth(1)).toContainText('-100,00');
});

test('does not offer a finished project for a correction, but lets one be taken away', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-04-05T10:00:00+02:00') });
  await page.clock.resume();

  await oppnaProjekt(page);
  await page.getByLabel('Kod').fill('LEADER-28');
  await page.getByLabel('Namn', { exact: true }).fill('Ny scen');
  await page.getByTestId('skapa-projekt').click();
  await expect(page.getByTestId('projektlista')).toContainText('LEADER-28');

  await page.goto('/#frikontering');
  await page.getByLabel('Vad avser det?').fill('Virke till scenen');
  await page.getByLabel('Konto, rad 1').fill('6100');
  await page.getByLabel('Debet, rad 1').fill('100');
  await page.getByLabel('Projekt, rad 1').selectOption({ label: 'LEADER-28 Ny scen' });
  await page.getByLabel('Konto, rad 2').fill('1930');
  await page.getByLabel('Kredit, rad 2').fill('100');
  await page.getByTestId('bokfor-fri').click();
  await expect(page.getByTestId('fri-besked')).toContainText('A1');

  await oppnaProjekt(page);
  await page.getByTestId('avsluta-LEADER-28').click();
  await expect(page.getByTestId('projektlista')).toContainText('Avslutat');

  await page.goto('/#verifikat');
  await page.getByTestId('verifikatlista').getByRole('button', { name: /A1/ }).click();
  await page.getByTestId(/^ratta-/).click();
  // The finished project is shown where the rad already has it, and nowhere else.
  await expect(page.getByLabel(/^Projekt, rad 1/)).toContainText('(avslutat)');
  await expect(page.getByLabel(/^Projekt, rad 2/)).toHaveCount(0);

  await page.getByLabel(/^Projekt, rad 1/).selectOption({ label: 'Inget projekt' });
  await page.getByTestId(/^spara-rattelse-/).click();
  const rader = page.getByTestId(/^kontering-/).getByRole('listitem');
  await expect(rader.nth(0)).not.toContainText('LEADER-28');
  await expect(page.getByTestId(/^rattelser-/)).toContainText(
    'LEADER-28 → inget projekt',
  );
});

/** Books one verifikat by hand; a row may name a project by its label. */
async function bokforRader(
  page: Page,
  beskrivning: string,
  rader: readonly {
    konto: string;
    sida: 'Debet' | 'Kredit';
    belopp: string;
    projekt?: string;
  }[],
  forvantad: string,
) {
  await page.goto('/#frikontering');
  await page.getByLabel('Vad avser det?').fill(beskrivning);
  for (const [index, rad] of rader.entries()) {
    if (index >= 2) {
      await page.getByTestId('lagg-till-rad').click();
    }
    const nr = index + 1;
    await page.getByLabel(`Konto, rad ${nr}`).fill(rad.konto);
    await page.getByLabel(`${rad.sida}, rad ${nr}`).fill(rad.belopp);
    if (rad.projekt !== undefined) {
      await page.getByLabel(`Projekt, rad ${nr}`).selectOption({ label: rad.projekt });
    }
  }
  await page.getByTestId('bokfor-fri').click();
  await expect(page.getByTestId('fri-besked')).toContainText(forvantad);
}

test('shows what a project took in, cost and has left of its grant', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-04-05T10:00:00+02:00') });
  await page.clock.resume();

  await oppnaProjekt(page);
  await page.getByLabel('Kod').fill('LEADER-28');
  await page.getByLabel('Namn', { exact: true }).fill('Ny scen');
  await page.getByTestId('skapa-projekt').click();
  await expect(page.getByTestId('projektlista')).toContainText('LEADER-28');

  const P = 'LEADER-28 Ny scen';
  // 10 000 kr granted and held as a skuld; 3 000 kr spent; 3 000 kr taken up as income.
  await bokforRader(
    page,
    'Beviljat bidrag',
    [
      { konto: '1930', sida: 'Debet', belopp: '10000' },
      { konto: '2900', sida: 'Kredit', belopp: '10000', projekt: P },
    ],
    'A1',
  );
  await bokforRader(
    page,
    'Virke',
    [
      { konto: '6100', sida: 'Debet', belopp: '3000', projekt: P },
      { konto: '1930', sida: 'Kredit', belopp: '3000' },
    ],
    'A2',
  );
  await bokforRader(
    page,
    'Bidraget tas upp som intäkt',
    [
      { konto: '2900', sida: 'Debet', belopp: '3000', projekt: P },
      { konto: '3980', sida: 'Kredit', belopp: '3000', projekt: P },
    ],
    'A3',
  );

  await page.goto('/#rapporter');
  await page.getByRole('button', { name: 'Projekt', exact: true }).click();
  await expect(page.getByTestId('pu-intakter')).toContainText('3 000,00');
  await expect(page.getByTestId('pu-intakter')).toContainText('3980');
  await expect(page.getByTestId('pu-kostnader')).toContainText('3 000,00');
  await expect(page.getByTestId('pu-resultat')).toContainText('0,00');
  // 10 000 received less the 3 000 taken up is what is left to use.
  await expect(page.getByTestId('pu-skulder')).toContainText('7 000,00');
  await expect(page.getByTestId('projektrader').getByRole('listitem')).toHaveCount(4);

  // Another year has nothing booked, and the grant still stands.
  await page.getByLabel('Period').selectOption({ index: 1 });
  await expect(page.getByTestId('pu-skulder')).toContainText('7 000,00');
});

test('has no project statement while the book has no project', async ({ page }) => {
  await page.goto('/#rapporter');
  await expect(page.getByRole('button', { name: 'Huvudbok' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Projekt', exact: true })).toHaveCount(0);
});

test('shares a common cost out on a project without changing the account', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-04-05T10:00:00+02:00') });
  await page.clock.resume();

  await oppnaProjekt(page);
  await page.getByLabel('Kod').fill('LEADER-28');
  await page.getByLabel('Namn', { exact: true }).fill('Ny scen');
  await page.getByTestId('skapa-projekt').click();
  await expect(page.getByTestId('projektlista')).toContainText('LEADER-28');

  // 1 000 kr of office supplies, on no project.
  await bokforRader(
    page,
    'Kontorsmaterial',
    [
      { konto: '6100', sida: 'Debet', belopp: '1000' },
      { konto: '1930', sida: 'Kredit', belopp: '1000' },
    ],
    'A1',
  );

  await page.goto('/#fordelning');
  const el = page.getByTestId('kostnader-per-konto').getByRole('listitem').first();
  await expect(el).toContainText('6100');
  await expect(el).toContainText('Totalt 1 000,00');
  await expect(el).toContainText('inget projekt 1 000,00');

  await page.getByTestId('fordela-6100').click();
  // More than there is to move is said, and the button stays off.
  await page.getByLabel('Belopp').fill('1500');
  await expect(page.getByTestId('fordela-hinder')).toContainText('mer än de 1 000,00 kr');
  await expect(page.getByTestId('bokfor-fordelning')).toBeDisabled();

  await page.getByLabel('Belopp').fill('300');
  await expect(page.getByTestId('fordela-hinder')).toBeHidden();
  await page.getByTestId('bokfor-fordelning').click();
  await expect(page.getByTestId('datautbyte-besked')).toContainText('A2');

  // The account is where it was; 300 kr moved from "no project" to the project.
  await expect(el).toContainText('Totalt 1 000,00');
  await expect(el).toContainText('på projekt 300,00');
  await expect(el).toContainText('inget projekt 700,00');

  await page.goto('/#rapporter');
  await page.getByRole('button', { name: 'Projekt', exact: true }).click();
  await expect(page.getByTestId('pu-kostnader')).toContainText('300,00');

  // And back again.
  await page.goto('/#fordelning');
  await page.getByTestId('fordela-6100').click();
  await page.getByLabel('Flytta').selectOption('fran_projekt');
  await page.getByLabel('Belopp').fill('100');
  await page.getByTestId('bokfor-fordelning').click();
  await expect(page.getByTestId('datautbyte-besked')).toContainText('A3');
  await expect(el).toContainText('på projekt 200,00');
  await expect(el).toContainText('inget projekt 800,00');
});

test('asks for a project before sharing anything out', async ({ page }) => {
  await page.goto('/#fordelning');
  await expect(page.getByTestId('fordela-inga-projekt')).toBeVisible();
});
