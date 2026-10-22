const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

// Wednesday 2026-10-14, period 3: an earlier run put an HS English teacher
// on a 7th grade class and an MS teacher on a 10th grade English class.
async function seedCrossed(page) {
  await page.evaluate(() => {
    const t = (id, name) => ({ id, name, tier: '1', highAvail: false, excluded: false,
      avail: { Monday: [], Tuesday: [], Wednesday: [3], Thursday: [], Friday: [] },
      lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 1 });
    setRoster([t('1', 'Ms. Chen'), t('2', 'Mr. Okafor')]);
    scheduleData = {
      'Absent MS': [{ day: 'Wednesday', period: 3, courseName: 'Science 7', section: 'SCI 7-1', room: '110', level: 'MS', subject: 'Science' }],
      'Absent HS': [{ day: 'Wednesday', period: 3, courseName: 'English 10', section: 'ENG 10-2', room: '203', level: 'US', subject: 'English' }],
      'Ms. Chen': [{ day: 'Monday', period: 1, courseName: 'Math 7', section: 'MTH 7-1', room: '1', level: 'MS', subject: 'Mathematics' }],
      'Mr. Okafor': [{ day: 'Monday', period: 2, courseName: 'English 11', section: 'ENG 11-1', room: '2', level: 'US', subject: 'English' }],
    };
    setLog([
      { date: '2026-10-14', absentTeacher: 'Absent MS', period: 3, courseName: 'Science 7', sectionNumber: 'SCI 7-1', roomNumber: '110', coveringTeacher: 'Mr. Okafor' },
      { date: '2026-10-14', absentTeacher: 'Absent HS', period: 3, courseName: 'English 10', sectionNumber: 'ENG 10-2', roomNumber: '203', coveringTeacher: 'Ms. Chen' },
    ]);
    document.getElementById('run-date').value = '2026-10-14';
    onDateChange();
  });
}

test.describe('Swap suggestions after a re-run', () => {
  test('a crossed MS/HS pair shows a suggestion; Swap them switches the classes without changing counts', async ({ page }) => {
    await gotoApp(page);
    await seedCrossed(page);
    const box = page.locator('.out-swap-box');
    await expect(box).toContainText('Suggested swap, Period 3');
    await expect(box).toContainText('Ms. Chen (middle school) would take SCI 7-1');
    await expect(box).toContainText('Mr. Okafor (teaches English) would take ENG 10-2');
    await expect(box).toContainText("If it already went out, it's a judgment call");
    await expect(page.locator('#output-doc tr.out-swap-hl')).toHaveCount(2);

    await box.getByRole('button', { name: 'Swap them' }).click();
    const after = await page.evaluate(() => ({
      log: Object.fromEntries(getLog().map(e => [e.sectionNumber, e.coveringTeacher])),
      totals: getRoster().map(t => t.totalCoverages),
    }));
    expect(after.log).toEqual({ 'SCI 7-1': 'Ms. Chen', 'ENG 10-2': 'Mr. Okafor' });
    expect(after.totals).toEqual([1, 1]);
    await expect(page.locator('.out-swap-box')).toHaveCount(0);
  });

  test('Keep as is hides the suggestion for good, including after switching dates and back', async ({ page }) => {
    await gotoApp(page);
    await seedCrossed(page);
    await page.locator('.out-swap-box').getByRole('button', { name: 'Keep as is' }).click();
    await expect(page.locator('.out-swap-box')).toHaveCount(0);
    await page.evaluate(() => {
      document.getElementById('run-date').value = '2026-10-15'; onDateChange();
      document.getElementById('run-date').value = '2026-10-14'; onDateChange();
    });
    await expect(page.locator('#output-doc')).toContainText('Mr. Okafor');
    await expect(page.locator('.out-swap-box')).toHaveCount(0);
    expect(await page.evaluate(() => getLog().find(e => e.sectionNumber === 'SCI 7-1').coveringTeacher)).toBe('Mr. Okafor');
  });

  test('no suggestion when the swap would not improve the match', async ({ page }) => {
    await gotoApp(page);
    await seedCrossed(page);
    await page.evaluate(() => {
      const log = getLog();
      log.find(e => e.sectionNumber === 'SCI 7-1').coveringTeacher = 'Ms. Chen';
      log.find(e => e.sectionNumber === 'ENG 10-2').coveringTeacher = 'Mr. Okafor';
      setLog(log);
      showSavedOutputForDate('2026-10-14');
    });
    await expect(page.locator('.out-swap-box')).toHaveCount(0);
  });
});
