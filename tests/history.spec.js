const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

// The Log tab is the old Summary and Log screens on one page: per-teacher
// totals, the weekly grid, and a collapsed Detailed Log underneath.
async function seedHistory(page) {
  await page.evaluate(() => {
    const t = (id, name, tier) => ({ id, name, tier, highAvail: false, excluded: false,
      avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
      lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 });
    setRoster([t('t1', 'Jane Smith', '1'), t('t2', 'Bob Jones', '3'), t('t3', 'Amy Lee', '2')]);
    setLog([
      { date: '2026-06-01', absentTeacher: 'Amy Lee', period: 1, courseName: 'Math', coveringTeacher: 'Jane Smith' },
      { date: '2026-06-02', absentTeacher: 'Jane Smith', period: 2, courseName: 'Art', coveringTeacher: 'Bob Jones' },
      { date: '2026-06-03', absentTeacher: 'Carl Moss', period: 3, courseName: 'Gym', coveringTeacher: 'Bob Jones' },
    ]);
    try { localStorage.removeItem('cs_history_show_tiers'); } catch {}
    showScreen('summary');
  });
}

test.describe('Log tab (old Summary + Log)', () => {
  test('the Log tab is gone, and the detailed log sits collapsed at the bottom of the Log tab', async ({ page }) => {
    await gotoApp(page);
    await seedHistory(page);
    await expect(page.locator('#nav-main .nav-btn:not(#settings-gear)')).toHaveText(['Run Coverage', 'Roster', 'Log']);
    await expect(page.locator('#detailed-log-body')).toBeHidden();
    await expect(page.locator('#detailed-log-toggle')).toContainText('(3)');

    await page.locator('#detailed-log-toggle').click();
    await expect(page.locator('#detailed-log-body')).toBeVisible();
    await expect(page.locator('#log-tbody tr')).toHaveCount(3);
  });

  test('searching a name filters the totals, the weekly grid, and the log (as absent or covering)', async ({ page }) => {
    await gotoApp(page);
    await seedHistory(page);
    await page.fill('#history-search', 'jane');

    await expect(page.locator('#summary-tbody tr')).toHaveCount(1);
    await expect(page.locator('#summary-tbody')).toContainText('Jane Smith');
    await expect(page.locator('#weekly-grid-body tbody tr')).toHaveCount(1);
    await expect(page.locator('#detailed-log-toggle')).toContainText('(2 matching)');

    await page.locator('#detailed-log-toggle').click();
    await expect(page.locator('#log-tbody tr')).toHaveCount(2); // covered Amy, and was covered by Bob

    await page.fill('#history-search', 'nobody');
    await expect(page.locator('#summary-tbody')).toContainText('No teacher matches that name.');
  });

  test('tiers are hidden on the Log tab by default, with no toggle on the page, and Settings turns them on (remembered)', async ({ page }) => {
    await gotoApp(page);
    await seedHistory(page);
    await expect(page.locator('#screen-summary').getByRole('button', { name: /tiers/i })).toHaveCount(0);
    await expect(page.locator('#summary-tbody .tier-col').first()).toBeHidden();
    await expect(page.locator('#weekly-grid-body .tier-col').first()).toBeHidden();
    const bg = await page.locator('#summary-tbody tr').first().evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgba(0, 0, 0, 0)');
    await expect(page.locator('#summary-tbody tr').first()).toContainText('Amy Lee'); // alphabetical, not by tier

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel(/Show tiers on Log/).check();
    await page.locator('#settings-modal').getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('#summary-tbody .tier-col').first()).toBeVisible();

    await page.reload();
    await page.evaluate(() => showScreen('summary'));
    await expect(page.locator('#summary-tbody .tier-col').first()).toBeVisible();
  });
  test('"Senior classes ended" lives in Settings, and Run Coverage shows a reminder only while it is on', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => showScreen('run'));
    await expect(page.locator('#screen-run #senior-classes-ended')).toHaveCount(0);
    await expect(page.locator('#senior-note')).toBeHidden();

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel(/Senior classes ended/).check();
    await page.locator('#settings-modal').getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('#senior-note')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('cs_senior_ended'))).toBe('1');

    await page.reload();
    await page.waitForSelector('#run-date');
    await expect(page.locator('#senior-note')).toBeVisible();
  });
  test('the Data menu only has Backup, Restore, and Excel Export; Restore offers file or GitHub; the rare and risky items live in Settings', async ({ page }) => {
    await gotoApp(page);
    await page.locator('#data-menu-btn').click();
    await expect(page.locator('#data-menu button')).toHaveText(['Backup', 'Restore', 'Excel Export']);

    await page.locator('#data-menu').getByRole('button', { name: 'Restore' }).click();
    await expect(page.locator('#restore-choice-modal')).toHaveClass(/open/);
    await expect(page.locator('#restore-choice-modal')).toContainText('From a backup file on this computer');
    await expect(page.locator('#restore-choice-modal')).toContainText('From a weekly GitHub backup (needs GitHub sync)');
    await page.locator('#restore-choice-modal').getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Settings' }).click();
    const settings = page.locator('#settings-modal');
    await expect(settings.getByRole('button', { name: 'Connect with GitHub' })).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Start New Year' })).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Clear Roster' })).toBeVisible();
  });
});
