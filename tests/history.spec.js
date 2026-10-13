const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

// History is the old Summary and Log screens on one page: per-teacher
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

test.describe('History screen', () => {
  test('the Log tab is gone, and the log sits collapsed at the bottom of History', async ({ page }) => {
    await gotoApp(page);
    await seedHistory(page);
    await expect(page.locator('#nav-main .nav-btn')).toHaveText(['Run Coverage', 'Roster', 'History']);
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

  test('tiers are hidden on History by default, with no toggle on the page, and Settings turns them on (remembered)', async ({ page }) => {
    await gotoApp(page);
    await seedHistory(page);
    await expect(page.locator('#screen-summary').getByRole('button', { name: /tiers/i })).toHaveCount(0);
    await expect(page.locator('#summary-tbody .tier-col').first()).toBeHidden();
    await expect(page.locator('#weekly-grid-body .tier-col').first()).toBeHidden();
    const bg = await page.locator('#summary-tbody tr').first().evaluate(el => getComputedStyle(el).backgroundColor);
    expect(bg).toBe('rgba(0, 0, 0, 0)');
    await expect(page.locator('#summary-tbody tr').first()).toContainText('Amy Lee'); // alphabetical, not by tier

    await page.locator('#data-menu-btn').click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByLabel(/Show tiers on History/).check();
    await page.locator('#settings-modal').getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('#summary-tbody .tier-col').first()).toBeVisible();

    await page.reload();
    await page.evaluate(() => showScreen('summary'));
    await expect(page.locator('#summary-tbody .tier-col').first()).toBeVisible();
  });
});
