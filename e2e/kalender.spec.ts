import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

test('hands over the coming deadlines as a calendar file', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-04T10:00:00+02:00') });
  await page.clock.resume();
  await page.goto('/');

  const nedladdning = page.waitForEvent('download');
  await page.getByTestId('exportera-kalender').click();
  const fil = await nedladdning;
  expect(fil.suggestedFilename()).toBe('kontera-datum.ics');
  await expect(page.getByTestId('kalender-besked')).toContainText('sparades');

  const ics = await readFile(await fil.path(), 'utf8');
  expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
  // The third quarter is due on 12 November, the fourth on 12 February.
  expect(ics).toContain('UID:moms-2026-07-01@kontera\r\n');
  expect(ics).toContain('DTSTART;VALUE=DATE:20261112\r\n');
  expect(ics).toContain('DTSTART;VALUE=DATE:20270212\r\n');
  // 2 May 2027 is a Sunday.
  expect(ics).toContain('UID:inkomstdeklaration-2026@kontera\r\n');
  expect(ics).toContain('DTSTART;VALUE=DATE:20270503\r\n');
  // The first two quarters have passed and are not in it.
  expect(ics).not.toContain('moms-2026-01-01');
});
