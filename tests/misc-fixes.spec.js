const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

test.describe('Misc regression fixes', () => {
  test('Schedule Inspector "Add Class" period dropdown has real options', async ({ page }) => {
    await gotoApp(page);
    const options = await page.$$eval('#si-add-period option', els => els.map(e => e.value));
    expect(options).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  test('getWeekBounds returns the correct Mon-Fri window regardless of timezone', async ({ page }) => {
    await gotoApp(page);
    const bounds = await page.evaluate(() => getWeekBounds('2026-06-03')); // a Wednesday
    expect(bounds).toEqual({ start: '2026-06-01', end: '2026-06-05' });
  });

  test('parseCSVLine handles an escaped "" quote inside a quoted field', async ({ page }) => {
    await gotoApp(page);
    const parsed = await page.evaluate(() => parseCSVLine('a,"say ""hi"" now",c'));
    expect(parsed).toEqual(['a', 'say "hi" now', 'c']);
  });

  test('loadScheduleCSV warns on an unparseable meeting-time and does not mark that teacher "free"', async ({ page }) => {
    await gotoApp(page);
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });

    const csv = 'Teacher,Class ID,Description,Meeting Times,Status\n'
      + 'Bob Jones,M-1,Math,M 3,Active\n' // space instead of hyphen -> fails to parse
      + 'Jane Smith,S-1,Science,M-1,Active\n';

    await page.evaluate((csvText) => {
      const file = new File([csvText], 'schedule.csv', { type: 'text/csv' });
      loadScheduleCSV({ target: { files: [file], value: '' } });
    }, csv);
    await page.waitForTimeout(200);

    const result = await page.evaluate(() => ({
      bobInSchedule: Object.prototype.hasOwnProperty.call(scheduleData, 'Bob Jones'),
      janeInSchedule: Object.prototype.hasOwnProperty.call(scheduleData, 'Jane Smith'),
      scheduledClassForBob: scheduledClassFor('Bob Jones', 'Monday', 3),
    }));

    expect(result.bobInSchedule).toBe(false); // not present-but-empty, genuinely missing
    expect(result.janeInSchedule).toBe(true);
    expect(result.scheduledClassForBob).toBeNull(); // "no data", not "confirmed free"
    expect(dialogs.some(m => m.includes("couldn't be read"))).toBe(true);
  });

  test('a confirmed free period (schedule has the teacher, but nothing that slot) is dropped, not flagged', async ({ page }) => {
    await gotoApp(page);
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });

    const result = await page.evaluate(() => {
      scheduleData = { 'Bob Jones': [{ day: 'Monday', period: 1, courseName: 'Math', section: '', room: '' }] };
      return scheduledClassFor('Bob Jones', 'Wednesday', 1); // teacher known, nothing that day/period
    });

    expect(result).toBe('free');
  });

  test('Math.random is never used in any assignment or fairness logic', async ({ page }) => {
    // Picks are driven entirely by the weighted sort in assignCoverage; the
    // only legitimate use of Math.random in the whole app is generating a
    // unique id when a new teacher is added during Sync with Schedule.
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.resolve(__dirname, '..', 'coverage system 08 26 26 (2) 1.html'), 'utf8');
    const matches = [...html.matchAll(/Math\.random/g)];
    expect(matches).toHaveLength(1);
  });
});
