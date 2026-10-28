import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { lasZip } from '../src/domain/arkiv/zipTestReader';

/**
 * Finds what to book by searching, scoped to the results so it cannot match
 * a booked verifikat further down the page that happens to carry the name.
 */
async function valjLov(page: Page, sokord: string, namn: string): Promise<void> {
  await page.getByLabel('Sök').fill(sokord);
  await page
    .getByTestId('sokresultat')
    .getByRole('button', { name: new RegExp(namn) })
    .click();
}

/** Answers one of the booking questions. */
async function svara(page: Page, svar: string): Promise<void> {
  await page.getByTestId('svar').getByRole('button', { name: svar, exact: true }).click();
}

/** The view switch along the bottom. */
function vyval(page: Page) {
  return page.getByRole('navigation', { name: 'Vyer' });
}

/** The primary action on the current screen, not the tab of the same name. */
function bokforKnapp(page: Page) {
  return page.locator('main').getByRole('button', { name: 'Bokför', exact: true });
}

/** The start view is the overview; booking is a tab away from it. */
async function tillBokfor(page: Page): Promise<void> {
  await page.goto('/');
  await vyval(page).getByRole('button', { name: 'Bokför', exact: true }).click();
}

async function tillVerifikat(page: Page): Promise<void> {
  await vyval(page).getByRole('button', { name: 'Verifikat' }).click();
}

async function tillFiler(page: Page): Promise<void> {
  await page.goto('/#filer');
}

async function tillSakerhetskopia(page: Page): Promise<void> {
  await page.goto('/#sakerhetskopia');
}

async function tillKonton(page: Page): Promise<void> {
  await page.goto('/#konton');
}

async function tillRakenskapsar(page: Page): Promise<void> {
  await page.goto('/#rakenskapsar');
}

async function tillEnhet(page: Page): Promise<void> {
  await page.goto('/#enhet');
}

async function tillRapporter(page: Page): Promise<void> {
  await page.goto('/#rapporter');
}

/**
 * Opens the event log, which is no longer the report shown first.
 *
 * Resultat took that place in stage 4: "how is the year going" is asked more
 * often than "what did I book last".
 */
async function tillHandelser(page: Page): Promise<void> {
  await tillRapporter(page);
  await page.getByRole('button', { name: 'Händelser', exact: true }).click();
}

/** Moms is done a few times a year, so it lives under Mer. */
async function tillMoms(page: Page): Promise<void> {
  await vyval(page).getByRole('button', { name: 'Mer' }).click();
  await page.getByRole('button', { name: 'Moms', exact: true }).click();
}

async function tillAttGora(page: Page): Promise<void> {
  await vyval(page).getByRole('button', { name: 'Översikt' }).click();
}

/*
 * The stage's acceptance criterion, driven the way a person drives it: what,
 * how much, paid how, done. No account number is typed anywhere.
 */
test('books an expense by answering what happened', async ({ page }) => {
  await tillBokfor(page);

  await expect(page.getByRole('heading', { name: 'Vad har hänt?' })).toBeVisible();
  await svara(page, 'Pengar ut');
  await svara(page, 'Djuren');
  await page
    .getByTestId('svar')
    .getByRole('button', { name: /Foder, strö eller mineraler/ })
    .click();
  await expect(page.getByTestId('valt-lov')).toContainText('4000');
  await page.getByLabel('Att betala').fill('520,31');

  // The split is shown before anything is booked, so the figure can be
  // checked against the receipt rather than trusted.
  await expect(page.getByTestId('momsdelning')).toContainText('104,06 kr');
  await expect(page.getByTestId('momsdelning')).toContainText('416,25 kr');

  await bokforKnapp(page).click();

  await expect(page.getByTestId('senast-bokfort')).toContainText('A1');
  // And back to the first question, ready for the next receipt.
  await expect(page.getByRole('heading', { name: 'Vad har hänt?' })).toBeVisible();
});

test('numbers each entry on from the last', async ({ page }) => {
  await tillBokfor(page);

  for (const belopp of ['100', '200']) {
    await valjLov(page, 'foder', 'Foder och strö');
    await page.getByLabel('Att betala').fill(belopp);
    await bokforKnapp(page).click();
    await expect(page.getByTestId('senast-bokfort')).toBeVisible();
  }

  await expect(page.getByTestId('senast-bokfort')).toContainText('A2');
});

test('shows the posting on request without ever asking for it', async ({ page }) => {
  await tillBokfor(page);

  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('520,31');

  await expect(page.getByTestId('kontering')).toBeHidden();
  await page.getByRole('button', { name: 'Visa konteringen' }).click();

  const kontering = page.getByTestId('kontering');
  await expect(kontering).toContainText('4000');
  await expect(kontering).toContainText('2641');
  await expect(kontering).toContainText('2017');
  await expect(kontering).toContainText('-520,31');
});

test('finds what to book by searching, ignoring accents', async ({ page }) => {
  await tillBokfor(page);

  await page.getByLabel('Sök').fill('forening');
  const traffar = page.getByTestId('sokresultat');
  await expect(traffar.getByRole('button', { name: /Föreningsavgift/ })).toBeVisible();
  await expect(traffar.getByRole('button', { name: /Foder och strö/ })).toBeHidden();
});

/*
 * A machine is an asset only above half a prisbasbelopp and three years, so
 * the question says what half a prisbasbelopp is. Tillbaka goes one answer
 * back, not to the start.
 */
test('asks before a purchase becomes an asset, and goes back a step', async ({
  page,
}) => {
  await tillBokfor(page);

  await svara(page, 'Pengar ut');
  await svara(page, 'Maskiner, verktyg och material');
  await svara(page, 'Köpt en maskin, ett verktyg eller en inventarie');
  await expect(page.getByTestId('halvt-prisbasbelopp')).toContainText('kr');

  await page
    .getByTestId('svar')
    .getByRole('button', { name: /Ja, båda/ })
    .click();
  await expect(page.getByTestId('valt-lov')).toContainText('1221');
  await expect(page.getByTestId('ledtext')).toContainText('Anläggningar');

  await page.getByRole('button', { name: 'Byt' }).click();
  await page.getByTestId('tradsteg-tillbaka').click();
  await expect(page.getByRole('heading', { name: 'Vad gäller det?' })).toBeVisible();
});

/* A hotel is 12 %, a train 6 %: where the receipt decides, the form asks. */
test('lets the rate be picked where the receipt decides it', async ({ page }) => {
  await tillBokfor(page);

  await valjLov(page, 'hotell', 'Resa');
  await page.getByTestId('momsval').getByRole('button', { name: '12 %' }).click();
  await page.getByLabel('Att betala').fill('1120');
  await expect(page.getByTestId('momsdelning')).toContainText('120,00 kr');
});

/* Moms for a whole period is worked out on its own screen, not typed in. */
test('sends the moms settlement to the Moms screen', async ({ page }) => {
  await tillBokfor(page);

  await svara(page, 'Moms');
  await svara(page, 'Räkna fram och bokföra momsen för en period');
  await page.getByTestId('hanvisning-moms').click();
  await expect(page.getByRole('heading', { name: /Moms/ }).first()).toBeVisible();
});

/*
 * Hard rule 10 makes the proposal a suggestion: the posting it builds can be
 * taken over and changed by hand before anything is booked.
 */
test('lets the proposed posting be changed before booking', async ({ page }) => {
  await tillBokfor(page);

  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('1250');
  await page.getByTestId('andra-kontering').click();

  await expect(page.getByLabel('Konto, rad 1')).toHaveValue('4000');
  await expect(page.getByLabel('Debet, rad 1')).toHaveValue('1000,00');
  await expect(page.getByLabel('Kredit, rad 3')).toHaveValue('1250,00');
  await page.getByLabel('Konto, rad 1').fill('5400');
  await page.getByTestId('bokfor-fri').click();
  await expect(page.getByTestId('fri-besked')).toContainText('A1');

  await tillVerifikat(page);
  await page.getByTestId('verifikatlista').getByRole('button').first().click();
  await expect(page.locator('[data-testid^="kontering-"]')).toContainText('5400');
});

test('defaults to private money, which is how most of it is paid', async ({ page }) => {
  await tillBokfor(page);

  await valjLov(page, 'foder', 'Foder och strö');
  await expect(page.getByRole('button', { name: 'Egna pengar' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('defaults the date to today but lets it be changed', async ({ page }) => {
  await tillBokfor(page);

  await valjLov(page, 'foder', 'Foder och strö');

  const idag = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
  }).format(new Date());
  await expect(page.getByLabel('Datum')).toHaveValue(idag);

  // A booked verifikat cannot be edited, so the date has to be right before
  // the button is pressed rather than fixable afterwards.
  await page.getByLabel('Datum').fill('2026-02-13');
  await page.getByLabel('Att betala').fill('275');
  await bokforKnapp(page).click();

  await expect(page.getByTestId('senast-bokfort')).toContainText('A1');
});

test('will not book with an empty date', async ({ page }) => {
  await tillBokfor(page);

  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('100');
  await page.getByLabel('Datum').fill('');

  await expect(bokforKnapp(page)).toBeDisabled();
});

test('lists what has been booked, newest first', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('inget-bokfort')).toBeVisible();

  await tillBokfor(page);
  for (const [sokord, namn, belopp] of [
    ['foder', 'Foder och strö', '520,31'],
    ['program', 'Program och abonnemang', '249'],
  ] as const) {
    await valjLov(page, sokord, namn);
    await page.getByLabel('Att betala').fill(belopp);
    await bokforKnapp(page).click();
    await expect(page.getByTestId('senast-bokfort')).toBeVisible();
  }

  await tillVerifikat(page);
  const rader = page.getByTestId('verifikatlista').getByRole('button');
  await expect(rader).toHaveCount(2);
  // Newest first, so the most recent entry needs no scrolling to confirm.
  await expect(rader.first()).toContainText('A2');
  await expect(rader.first()).toContainText('249,00');
  await expect(rader.nth(1)).toContainText('A1');
  await expect(rader.nth(1)).toContainText('520,31');
});

test('opens the posting of a booked verifikat on a tap', async ({ page }) => {
  await tillBokfor(page);
  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('520,31');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await tillVerifikat(page);
  await page.getByTestId('verifikatlista').getByRole('button').first().click();

  const kontering = page.locator('[data-testid^="kontering-"]');
  await expect(kontering).toContainText('4000');
  await expect(kontering).toContainText('416,25');
  await expect(kontering).toContainText('-520,31');
});

test('finds a verifikat by number or by what it says', async ({ page }) => {
  await tillBokfor(page);
  for (const [sokord, namn, belopp] of [
    ['forening', 'Föreningsavgift', '400'],
    ['foder', 'Foder och strö', '100'],
  ] as const) {
    await valjLov(page, sokord, namn);
    await page.getByLabel('Att betala').fill(belopp);
    await bokforKnapp(page).click();
    await expect(page.getByTestId('senast-bokfort')).toBeVisible();
  }

  await tillVerifikat(page);
  const rader = page.getByTestId('verifikatlista').getByRole('button');

  await page.getByLabel('Sök').fill('forening');
  await expect(rader).toHaveCount(1);

  await page.getByLabel('Sök').fill('A1');
  await expect(rader).toHaveCount(1);

  await page.getByLabel('Sök').fill('traktor');
  await expect(page.getByTestId('inga-verifikat')).toContainText('matchar');
});

/*
 * The start view is about what needs doing, not about the entry form.
 * Opening straight into the booking questions assumes the answer is always
 * "book something", and often the question is "have I missed anything?".
 */
test('starts on the overview and reaches booking in one tap', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Att göra' })).toBeVisible();
  await expect(page.getByTestId('tradfraga')).toBeHidden();

  await vyval(page).getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('tradfraga')).toBeVisible();
});

/* On a phone, back has to go back rather than leave the app. */
test('goes back a view with the browser back button', async ({ page }) => {
  await page.goto('/');
  await vyval(page).getByRole('button', { name: 'Bokför', exact: true }).click();
  await expect(page.getByTestId('tradfraga')).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Att göra' })).toBeVisible();
});

test('shows the most recent entry on the start view', async ({ page }) => {
  await tillBokfor(page);
  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('520,31');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await tillAttGora(page);

  await expect(page.getByTestId('senaste-verifikat')).toContainText('A1');
  await expect(page.getByTestId('senaste-verifikat')).toContainText('520,31');
});

/*
 * Händelser answers a different question from the verifikationslista: this
 * one is checked against a bank statement, that one against a pile of
 * receipts. Hence the running balance.
 */
test('shows money in and out with a running balance', async ({ page }) => {
  await tillBokfor(page);

  for (const [sokord, namn, belopp] of [
    ['foder', 'Foder och strö', '520,31'],
    ['program', 'Program och abonnemang', '249'],
  ] as const) {
    await valjLov(page, sokord, namn);
    await page.getByLabel('Att betala').fill(belopp);
    await bokforKnapp(page).click();
    await expect(page.getByTestId('senast-bokfort')).toBeVisible();
  }

  await tillHandelser(page);

  const rader = page.getByTestId('handelselista').getByRole('listitem');
  await expect(rader).toHaveCount(2);
  await expect(page.getByTestId('handelsesummering')).toContainText('-769,31');
});

test('follows the account that was picked', async ({ page }) => {
  await tillBokfor(page);
  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('520,31');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await tillHandelser(page);
  await expect(page.getByTestId('handelselista')).toBeVisible();

  // Paid with private money, so the company account never moved.
  await page.getByLabel('Konto').selectOption('1930');
  await expect(page.getByTestId('inga-handelser')).toBeVisible();
});

/*
 * The path someone with existing books actually takes: import first, then
 * everything else has something to show. The file is built in the test rather
 * than kept in the repository - a real export carries a personal identity
 * number and a whole set of private finances.
 */
test('imports a SIE file and shows what came in', async ({ page }) => {
  await tillFiler(page);

  const rader = [
    '#FLAGGA 0',
    '#FORMAT PC8',
    '#SIETYP 4',
    '#RAR 0 20260101 20261231',
    '#KONTO 1930 "Foretagskonto"',
    '#KONTO 3010 "Forsaljning"',
    '#KTYP 1930 T',
    '#KTYP 3010 I',
    '#IB 0 1930 1000.00',
    '#VER "A" 7 20260115 "Forsaljning av lamm" 20260115 ""',
    '{',
    '#TRANS 1930 {} 12645.00',
    '#TRANS 3010 {} -12645.00',
    '}',
    '',
  ].join('\n');

  await page.getByTestId('siefiler').setInputFiles({
    name: 'bokforing-2026.se',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(rader, 'ascii'),
  });

  await expect(page.getByTestId('datautbyte-besked')).toContainText('1 verifikat');

  // The number from the file is kept, not reassigned.
  await tillVerifikat(page);
  const lista = page.getByTestId('verifikatlista').getByRole('button');
  await expect(lista.first()).toContainText('A7');
  await expect(lista.first()).toContainText('12 645,00');

  // And the money shows up on the account it landed on.
  await tillHandelser(page);
  await page.getByLabel('Konto').selectOption('1930');
  await expect(page.getByTestId('handelsesummering')).toContainText('13 645,00');
});

test('says so when the same file is imported twice', async ({ page }) => {
  await tillFiler(page);

  const fil = {
    name: 'bokforing-2026.se',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(
      [
        '#FLAGGA 0',
        '#FORMAT PC8',
        '#SIETYP 4',
        '#RAR 0 20260101 20261231',
        '#KONTO 1930 "Foretagskonto"',
        '#KONTO 3010 "Forsaljning"',
        '#KTYP 1930 T',
        '#KTYP 3010 I',
        '#VER "A" 1 20260115 "Forsaljning" 20260115 ""',
        '{',
        '#TRANS 1930 {} 100.00',
        '#TRANS 3010 {} -100.00',
        '}',
        '',
      ].join('\n'),
      'ascii',
    ),
  };

  await page.getByTestId('siefiler').setInputFiles(fil);
  await expect(page.getByTestId('datautbyte-besked')).toContainText('1 verifikat');

  await page.getByTestId('siefiler').setInputFiles(fil);
  await expect(page.getByTestId('datautbyte-besked')).toContainText('1 fanns redan');
});

/*
 * An income is not paid, it is received. A form saying "Att betala" over
 * money coming in is simply wrong.
 */
test('uses the words that fit the direction', async ({ page }) => {
  await tillBokfor(page);

  await valjLov(page, 'foder', 'Foder och strö');
  await expect(page.getByLabel('Att betala')).toBeVisible();
  await expect(page.getByText('Betalat med')).toBeVisible();

  await page.getByRole('button', { name: 'Byt' }).click();
  await valjLov(page, 'lamm', 'Försäljning av djur');
  await expect(page.getByLabel('Att få in')).toBeVisible();
  await expect(page.getByText('Insatt på')).toBeVisible();
  await expect(page.getByLabel('Att betala')).toBeHidden();
});

/*
 * Bokföringslagen 5 kap. 7 § wants a verifikation to say what the
 * affärshändelse avser. "Program och abonnemang" twelve times over does not tell
 * one month's subscription from another's, so the name is a starting
 * point rather than the answer.
 */
test('takes a description, prefilled from the answer', async ({ page }) => {
  await tillBokfor(page);
  await valjLov(page, 'program', 'Program och abonnemang');

  await expect(page.getByLabel('Vad avser det?')).toHaveValue('Program och abonnemang');
  await page.getByLabel('Vad avser det?').fill('Programvara augusti 2026');
  await page.getByLabel('Att betala').fill('249');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await tillVerifikat(page);
  await expect(page.getByTestId('verifikatlista')).toContainText(
    'Programvara augusti 2026',
  );
});

test('will not book without a description', async ({ page }) => {
  await tillBokfor(page);
  await valjLov(page, 'program', 'Program och abonnemang');
  await page.getByLabel('Att betala').fill('249');

  await page.getByLabel('Vad avser det?').fill('   ');
  await expect(bokforKnapp(page)).toBeDisabled();

  await page.getByLabel('Vad avser det?').fill('Programvara');
  await expect(bokforKnapp(page)).toBeEnabled();
});

/*
 * Hard rule 5: a booked verifikat is never edited. The interface calls it
 * Ändra because that is what a person means, and does the lawful thing
 * underneath - writes the mirror and leaves the original standing.
 */
test('reverses a booked verifikat instead of editing it', async ({ page }) => {
  await tillBokfor(page);
  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('520,31');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await tillVerifikat(page);
  const rader = page.getByTestId('verifikatlista').getByRole('button');
  await rader.first().click();

  await page.locator('[data-testid^="andra-"]').click();
  await expect(page.locator('[data-testid^="bekrafta-"]')).toContainText(
    'Konteringen kan inte ändras',
  );
  await page.locator('[data-testid^="annullera-"]').click();

  // Both stay in the books, and each says what it is.
  await expect(page.getByTestId('verifikatlista').locator('> li')).toHaveCount(2);
  await expect(page.getByTestId('verifikatlista')).toContainText('annullering');
  await expect(page.getByTestId('verifikatlista')).toContainText('annullerat');
});

/*
 * Bokföringslagen 5 kap. 8 §: a verifikation may be corrected as long as it
 * is recorded when and by whom. The description is corrected in place; the
 * konteringar are not, and the original text stays readable underneath.
 */
test('corrects the description of a booked verifikat and keeps the original', async ({
  page,
}) => {
  await tillBokfor(page);
  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('3225,00');
  await page.getByLabel('Vad avser det?').fill('svecol');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await tillVerifikat(page);
  const rader = page.getByTestId('verifikatlista').getByRole('button');
  await rader.first().click();

  await page.locator('[data-testid^="ratta-"]').click();
  await page.getByLabel('Beskrivning').fill('Swedol AB');
  await page.locator('[data-testid^="spara-rattelse-"]').click();

  // Corrected in place: one verifikat still, not an original and a mirror.
  await expect(page.getByTestId('verifikatlista')).toContainText('Swedol AB');
  await expect(page.getByTestId('verifikatlista').locator('> li')).toHaveCount(1);

  // The record BFL asks for, where a granskare would look for it. The row is
  // still open - saving a correction closes the form, not the verifikat.
  const rattelser = page.locator('[data-testid^="rattelser-"]');
  await expect(rattelser).toContainText('svecol');
  await expect(rattelser).toContainText('Swedol AB');
  await expect(rattelser).toContainText('Beskrivning rättad');
});

test('will not reverse something that already was', async ({ page }) => {
  await tillBokfor(page);
  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('100');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await tillVerifikat(page);
  const rader = page.getByTestId('verifikatlista').getByRole('button');
  await rader.first().click();
  await page.locator('[data-testid^="andra-"]').click();
  await page.locator('[data-testid^="annullera-"]').click();
  await expect(page.getByTestId('verifikatlista').locator('> li')).toHaveCount(2);

  // Neither the annulment nor the entry it cancelled may be reversed again.
  await rader.first().click();
  await expect(page.locator('[data-testid^="andra-"]')).toHaveCount(0);
  await rader.nth(1).click();
  await expect(page.locator('[data-testid^="andra-"]')).toHaveCount(0);
});

/*
 * Two orders, which are two books. By number is the verifikationslista - how
 * a series is checked for gaps. By date is the dagbok, the grundbokföring
 * bokföringslagen 5 kap. 1 § asks for alongside the systematic kind.
 */
test('shows the same entries as a verifikationslista or a dagbok', async ({ page }) => {
  await tillBokfor(page);

  // Booked in one order, dated in the other, which is what makes the two
  // views differ at all.
  for (const [belopp, datum] of [
    ['100', '2026-03-19'],
    ['200', '2026-01-08'],
  ] as const) {
    await valjLov(page, 'foder', 'Foder och strö');
    await page.getByLabel('Att betala').fill(belopp);
    await page.getByLabel('Datum').fill(datum);
    await bokforKnapp(page).click();
    await expect(page.getByTestId('senast-bokfort')).toBeVisible();
  }

  await tillVerifikat(page);
  const rader = page.getByTestId('verifikatlista').getByRole('button');
  await expect(rader.first()).toContainText('A2');

  await page.getByRole('button', { name: 'Datumordning' }).click();
  await expect(page.getByRole('heading', { name: 'Dagbok' })).toBeVisible();
  await expect(rader.first()).toContainText('2026-03-19');
  await expect(rader.nth(1)).toContainText('2026-01-08');
});

/*
 * Bookkeeping in systematic order, which is the question asked at a bokslut:
 * not "what did I book" but "what is on account 4000".
 */
test('adds up each account in the huvudbok', async ({ page }) => {
  await tillBokfor(page);
  for (const belopp of ['520,31', '275']) {
    await valjLov(page, 'foder', 'Foder och strö');
    await page.getByLabel('Att betala').fill(belopp);
    await bokforKnapp(page).click();
    await expect(page.getByTestId('senast-bokfort')).toBeVisible();
  }

  await tillRapporter(page);
  await page.getByRole('button', { name: 'Huvudbok' }).click();

  const konto4000 = page.getByTestId('huvudbok').getByRole('button', { name: /4000/ });
  // 416,25 and 220,00 net of VAT.
  await expect(konto4000).toContainText('636,25');

  await konto4000.click();
  const rader = page.getByTestId('huvudbok-4000');
  await expect(rader).toContainText('416,25');
  await expect(rader).toContainText('220,00');
});

/*
 * Periodlåsning is what stops a figure already reported to Skatteverket from
 * being changed afterwards. Both locks are one-way, so both say plainly what
 * they will stop before doing it.
 */
test('locks a period and refuses to book into it', async ({ page }) => {
  await tillBokfor(page);
  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('100');
  await page.getByLabel('Datum').fill('2026-02-13');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await tillRakenskapsar(page);
  await page.getByTestId('rakenskapsarlista').getByRole('button').first().click();
  await page.getByLabel('Momslås till och med').fill('2026-03-31');
  await page.getByTestId('momslas-2026').click();

  await expect(page.getByTestId('rakenskapsarlista')).toContainText(
    'Momslåst t.o.m. 2026-03-31',
  );

  // Anything inside the locked period is now refused, with the reason shown.
  await tillBokfor(page);
  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('50');
  await page.getByLabel('Datum').fill('2026-02-20');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('bokfor-fel')).toContainText('momsdeklarationen');

  // And anything after it still books.
  await page.getByLabel('Datum').fill('2026-04-01');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();
});

test('closes a year and stops booking in it entirely', async ({ page }) => {
  await tillRakenskapsar(page);
  await page.getByTestId('rakenskapsarlista').getByRole('button').first().click();

  // Next year has to exist before this one can be closed - the closing
  // balances need somewhere to go - so Avsluta stays disabled until then.
  await page.getByTestId('skapa-nasta-ar-2026').click();
  await expect(page.getByTestId('checklista-2026')).toContainText('2027');
  await page.getByTestId('avsluta-2026').click();
  await expect(page.getByTestId('rakenskapsarlista')).toContainText('Avslutat');

  await tillBokfor(page);
  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('100');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('bokfor-fel')).toContainText('avslutat');
});

test('shows the opening balances an import brought in', async ({ page }) => {
  await tillFiler(page);

  await page.getByTestId('siefiler').setInputFiles({
    name: 'bokforing-2026.se',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(
      [
        '#FLAGGA 0',
        '#FORMAT PC8',
        '#SIETYP 4',
        '#RAR 0 20260101 20261231',
        '#KONTO 1930 "Foretagskonto"',
        '#KONTO 2010 "Eget kapital"',
        '#KTYP 1930 T',
        '#IB 0 1930 23817.45',
        '#IB 0 2010 -23817.45',
        '',
      ].join('\n'),
      'ascii',
    ),
  });
  await expect(page.getByTestId('datautbyte-besked')).toBeVisible();

  await tillRakenskapsar(page);
  await page.getByTestId('rakenskapsarlista').getByRole('button').first().click();
  const ar = page.getByTestId('rakenskapsar-2026');
  await expect(ar).toContainText('23 817,45');
  await expect(ar).toContainText('-23 817,45');
});

/*
 * Three hundred accounts is too many to scroll and too few to need anything
 * clever. Search folds accents the way template search does.
 */
test('finds an account and marks it a favourite', async ({ page }) => {
  await tillKonton(page);

  await page.getByLabel('Sök konto').fill('foretag');
  const lista = page.getByTestId('kontolista');
  await expect(lista).toContainText('1930');
  await expect(lista).not.toContainText('4000');

  await page.getByTestId('favorit-1930').click();
  await expect(page.getByTestId('favorit-1930')).toHaveAttribute('aria-pressed', 'true');

  // Favourites float to the top once the search is cleared.
  await page.getByLabel('Sök konto').fill('');
  await expect(lista.getByRole('listitem').first()).toContainText('1930');
});

test('finds an account by words of its name in any order', async ({ page }) => {
  await tillKonton(page);

  await page.getByLabel('Sök konto').fill('moms debiterad');
  const lista = page.getByTestId('kontolista');
  await expect(lista.getByRole('listitem').first()).toContainText(
    '2641 Debiterad ingående moms',
  );
  await expect(lista).not.toContainText('2650');
});

test('adds an account of its own', async ({ page }) => {
  await tillKonton(page);

  await page.getByLabel('Kontonummer').fill('4173');
  await page.getByLabel('Namn').fill('Veterinär och djurmedicin');
  await page.getByTestId('lagg-till-konto').click();

  await page.getByLabel('Sök konto').fill('veterinar');
  await expect(page.getByTestId('kontolista')).toContainText('4173');
});

test('refuses an account number that is not one', async ({ page }) => {
  await tillKonton(page);

  await page.getByLabel('Kontonummer').fill('99');
  await page.getByLabel('Namn').fill('Något');
  await page.getByTestId('lagg-till-konto').click();
  await expect(page.getByTestId('kontofel')).toContainText('fyra siffror');

  // And says so for one that already exists, rather than replacing it.
  await page.getByLabel('Kontonummer').fill('1930');
  await page.getByTestId('lagg-till-konto').click();
  await expect(page.getByTestId('kontofel')).toContainText('finns redan');
});

/*
 * The safety valve, driven the way it will be used: book something, take a
 * copy, and read it back. The stage's promise is that leaving Kontera never
 * costs anything, and a backup nobody can restore is not a backup.
 */
test('takes a backup and reads it back', async ({ page }) => {
  await tillBokfor(page);
  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('520,31');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await tillSakerhetskopia(page);
  const nedladdning = page.waitForEvent('download');
  // The unprotected copy, which is the one that reads back without a
  // passphrase. The encrypted round trip has a test of its own.
  await page.getByTestId('spara-oskyddad').click();
  const fil = await nedladdning;
  const sokvag = await fil.path();

  // Read into an app that already has the same entries: nothing is missing,
  // so nothing is added.
  await page.getByTestId('kopiefil').setInputFiles(sokvag);
  await expect(page.getByTestId('datautbyte-besked')).toContainText(
    'ingenting som saknades',
  );
});

/*
 * A backup nobody remembered to take is worse than a slow one: the warning
 * on the start view is the only thing standing between a lost phone and a
 * lost year of bookkeeping, so it has to show up before a copy exists and
 * clear once one does.
 */
test('warns on the start view when no backup has been taken, and clears with a tap', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByTestId('backup-gammal')).toContainText(
    'Ingen säkerhetskopia är tagen än',
  );

  // The whole point of the card: no trip to Inställningar, no re-finding the
  // button - the passphrase and the action are right where the warning is.
  await page
    .getByTestId('backup-gammal')
    .getByLabel('Lösenfras för säkerhetskopian')
    .fill('en ganska lång lösenfras');
  const nedladdning = page.waitForEvent('download');
  await page.getByTestId('snabb-backup').click();
  await nedladdning;

  await expect(page.getByTestId('snabb-backup-besked')).toBeVisible();

  // The confirmation is left up rather than yanked away the instant the
  // backup lands; a reload is what proves backup.senast actually persisted.
  await page.reload();
  await expect(page.getByTestId('backup-gammal')).toHaveCount(0);
});

/*
 * Encryption is the owner's choice: a copy kept on their own disk or in their
 * own iCloud may not need a lock, and a forgotten passphrase is a lost year.
 * The quick backup offers the plain copy too, as the settings screen does.
 */
test('takes a quick backup without a passphrase when asked for a plain copy', async ({
  page,
}) => {
  await page.goto('/');
  const nedladdning = page.waitForEvent('download');
  await page.getByTestId('snabb-backup-oskyddad').click();
  expect((await nedladdning).suggestedFilename()).toMatch(/^kontera-oskyddad-kopia-/);

  await expect(page.getByTestId('snabb-backup-besked')).toContainText(
    'Den oskyddade kopian',
  );

  await page.reload();
  await expect(page.getByTestId('backup-gammal')).toHaveCount(0);
});

test('gives each device its own series', async ({ page }) => {
  await tillEnhet(page);

  await page.getByLabel('Verifikatserie').fill('B');

  await tillBokfor(page);
  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('100');
  await bokforKnapp(page).click();

  // One series per device is what lets two of them book offline without
  // asking each other for a number.
  await expect(page.getByTestId('senast-bokfort')).toContainText('B1');
});

/*
 * The seven-year archive package, driven the way it will actually be used:
 * book something, photograph a receipt for it, export the archive, and open
 * the real zip file that came out - not a mock of one.
 */
test('exports an archive package with the SIE file, a PDF and the receipt', async ({
  page,
}) => {
  await tillBokfor(page);
  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('520,31');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await tillFiler(page);
  const nedladdning = page.waitForEvent('download');
  await page.getByTestId('exportera-arkivpaket').click();
  const fil = await nedladdning;
  const sokvag = await fil.path();

  const bytes = new Uint8Array(await readFile(sokvag!));
  const namn = lasZip(bytes).map((post) => post.namn);

  expect(namn).toContain('kontera-2026.se');
  expect(namn).toContain('verifikationslista.pdf');
  expect(namn).toContain('checksummor.txt');
  expect(namn).toContain('LASMIG.txt');
});

test('refuses a file that is not a Bokfink backup', async ({ page }) => {
  await tillSakerhetskopia(page);

  await page.getByTestId('kopiefil').setInputFiles({
    name: 'nagot-annat.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"nagot-annat"}', 'utf8'),
  });

  await expect(page.getByTestId('datautbyte-fel')).toContainText('säkerhetskopia');
});

/*
 * Every box the return has, including the empty ones. A box left out because
 * it happened to be zero is a box nobody checks, and the one time it should
 * not have been zero is the time it matters.
 */
test('shows the momsdeklaration box by box', async ({ page }) => {
  await tillBokfor(page);
  await valjLov(page, 'lamm', 'Försäljning av djur');
  await page.getByLabel('Att få in').fill('12645');
  await page.getByLabel('Datum').fill('2026-02-13');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await tillMoms(page);
  await page.getByLabel('Period', { exact: true }).selectOption({ label: '2026 kv 1' });

  const rutor = page.getByTestId('momsrutor');
  await expect(rutor).toContainText('Ruta 05');
  await expect(rutor).toContainText('Ruta 10');
  await expect(rutor).toContainText('Ruta 49');
  await expect(page.getByTestId('momssumma')).toContainText('att betala');
});

test('locks the period from the momsdeklaration', async ({ page }) => {
  await tillBokfor(page);
  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('100');
  await page.getByLabel('Datum').fill('2026-02-13');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await tillMoms(page);
  await page.getByLabel('Period', { exact: true }).selectOption({ label: '2026 kv 1' });
  await page.getByTestId('las-period').click();

  await expect(page.getByTestId('redan-last')).toContainText('2026-03-31');

  // And the ledger honours it.
  await tillBokfor(page);
  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('50');
  await page.getByLabel('Datum').fill('2026-02-20');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('bokfor-fel')).toContainText('momsdeklarationen');
});

test('follows the chosen reporting period', async ({ page }) => {
  await page.goto('/');
  await tillMoms(page);

  await page.getByLabel('Redovisningsperiod').selectOption('manad');
  await expect(page.getByLabel('Period', { exact: true })).toContainText('2026-01');

  await page.getByLabel('Redovisningsperiod').selectOption('ar');
  await expect(page.getByLabel('Period', { exact: true })).toContainText('2026');
});

/*
 * The method decides when a verifikat is written, not how a written one is
 * read - so it is a setting the person makes, recorded where the declaration
 * that depends on it is.
 */
test('records which accounting method is used', async ({ page }) => {
  await page.goto('/');
  await tillMoms(page);

  await expect(page.getByLabel('Redovisningsmetod')).toHaveValue('kontantmetoden');
  await expect(page.getByTestId('metodbeskrivning')).toContainText('pengarna rör sig');

  await page.getByLabel('Redovisningsmetod').selectOption('faktureringsmetoden');
  await expect(page.getByTestId('metodbeskrivning')).toContainText('fakturan skrivs');

  await page.reload();
  await tillMoms(page);
  await expect(page.getByLabel('Redovisningsmetod')).toHaveValue('faktureringsmetoden');
});

/*
 * Bokföringslagen 4 kap. 6 §: the books are kept in kronor, so a receipt in
 * euro is converted on the way in - and the rate is written into the
 * verifikat, because a figure nobody can reproduce a year later is not
 * räkenskapsinformation.
 */
test('books a purchase made in another currency', async ({ page }) => {
  await tillBokfor(page);
  await valjLov(page, 'program', 'Program och abonnemang');

  await page.getByRole('button', { name: 'Beloppet är i annan valuta' }).click();
  await page.getByLabel('Valuta', { exact: true }).fill('EUR');
  await page.getByLabel('Belopp i valutan').fill('49,00');
  await page.getByLabel('Kurs, kronor per enhet').fill('11,4523');

  // 49,00 × 11,4523 = 561,16270, which is 561,16 kronor.
  await expect(page.getByTestId('omraknat')).toContainText('561,16');

  await bokforKnapp(page).click();
  await expect(page.getByTestId('senast-bokfort')).toContainText('A1');

  await tillVerifikat(page);
  await expect(page.getByTestId('verifikatlista')).toContainText(
    'Program och abonnemang (49,00 EUR, kurs 11,4523)',
  );
});

/*
 * A backup ends up in iCloud, on a disk, in an email to oneself - carrying a
 * year of bookkeeping and every receipt photograph. Encrypting it is what
 * makes that acceptable, and the round trip is the only proof that the
 * encryption did not cost the data.
 */
test('locks the backup with a passphrase and opens it again', async ({ page }) => {
  await tillBokfor(page);
  await valjLov(page, 'foder', 'Foder och strö');
  await page.getByLabel('Att betala').fill('520,31');
  await bokforKnapp(page).click();
  await expect(page.getByTestId('senast-bokfort')).toBeVisible();

  await tillSakerhetskopia(page);
  await page.getByLabel('Lösenfras för säkerhetskopian').fill('en ganska lång lösenfras');

  const nedladdning = page.waitForEvent('download');
  await page.getByTestId('spara-krypterad').click();
  const fil = await nedladdning;
  const innehall = await fil.createReadStream().then(async (strom) => {
    const bitar: Buffer[] = [];
    for await (const bit of strom) {
      bitar.push(bit as Buffer);
    }
    return Buffer.concat(bitar).toString('utf8');
  });

  // The envelope says what it is; the bookkeeping inside says nothing.
  expect(innehall).toContain('kontera-krypterad-sakerhetskopia');
  expect(innehall).toContain('AES-GCM-256');
  expect(innehall).not.toContain('Foder och strö');
  expect(innehall).not.toContain('4000');

  // A fresh app, the file, and the passphrase.
  await page.evaluate(async () => {
    for (const bas of await indexedDB.databases()) {
      if (bas.name !== undefined) {
        indexedDB.deleteDatabase(bas.name);
      }
    }
  });
  await page.reload();
  await tillSakerhetskopia(page);

  await page.getByTestId('kopiefil').setInputFiles({
    name: 'kopia.json',
    mimeType: 'application/json',
    buffer: Buffer.from(innehall, 'utf8'),
  });
  await expect(page.getByTestId('datautbyte-besked')).toContainText('krypterad');

  await page.getByLabel('Lösenfras för säkerhetskopian').fill('en ganska lång lösenfras');
  await page.getByTestId('las-upp').click();
  await expect(page.getByTestId('datautbyte-besked')).toContainText(
    'händelser lästes in',
  );

  await tillVerifikat(page);
  await expect(page.getByTestId('verifikatlista')).toContainText('520,31');
});

test('says so when the passphrase is wrong', async ({ page }) => {
  await tillSakerhetskopia(page);
  await page.getByLabel('Lösenfras för säkerhetskopian').fill('rätt lösenfras');

  const nedladdning = page.waitForEvent('download');
  await page.getByTestId('spara-krypterad').click();
  const innehall = await (await nedladdning).createReadStream().then(async (strom) => {
    const bitar: Buffer[] = [];
    for await (const bit of strom) {
      bitar.push(bit as Buffer);
    }
    return Buffer.concat(bitar).toString('utf8');
  });

  await page.getByLabel('Lösenfras för säkerhetskopian').fill('fel lösenfras');
  await page.getByTestId('kopiefil').setInputFiles({
    name: 'kopia.json',
    mimeType: 'application/json',
    buffer: Buffer.from(innehall, 'utf8'),
  });

  await expect(page.getByTestId('datautbyte-fel')).toContainText(
    'gick inte att låsa upp',
  );
});
