const { test, expect } = require('@playwright/test');
const { gotoApp, APP_PATH } = require('./helpers');

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

  test('Room Chart matching ignores case, since the Schedule and Room Chart exports don\'t agree on it', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    // Real-world shape: the Room Chart export writes this class in Title
    // Case ("Eng 11-4"), the Schedule export writes the same class in
    // all-caps ("ENG 11-4"). They have to be treated as the same class.
    const csv = 'CAP,,M1\n20,420,Eng 11-4\n';
    await page.evaluate((csvText) => {
      const file = new File([csvText], 'roomchart.csv', { type: 'text/csv' });
      loadRoomChartCSV({ target: { files: [file], value: '' } });
    }, csv);
    await page.waitForTimeout(200);

    const room = await page.evaluate(() => getRoomFromChart('ENG 11-4', 'Monday', 1));
    expect(room).toBe('420');

    // A schedule loaded afterward should pick the room up automatically too.
    const scheduleCsv = 'Teacher,Class ID,Description,Meeting Times,Status\n'
      + 'Jane Smith,ENG 11-4,English 11,M-1,Active\n';
    await page.evaluate((csvText) => {
      const file = new File([csvText], 'schedule.csv', { type: 'text/csv' });
      loadScheduleCSV({ target: { files: [file], value: '' } });
    }, scheduleCsv);
    await page.waitForTimeout(200);

    const scheduledRoom = await page.evaluate(() => scheduledClassFor('Jane Smith', 'Monday', 1).room);
    expect(scheduledRoom).toBe('420');
  });

  test('Room Chart matching falls back to a stripped class id when the Schedule side has an extra session/group suffix', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    // Real-world shape: the Schedule export tags the pull-out section
    // "MTH 8-1.G1.SCH", but the Room Chart export drops the ".SCH" and
    // just writes "Mth 8-1.g1" for the same class.
    const csv = 'CAP,,M3\n14,403,Mth 8-1.g1\n';
    await page.evaluate((csvText) => {
      const file = new File([csvText], 'roomchart.csv', { type: 'text/csv' });
      loadRoomChartCSV({ target: { files: [file], value: '' } });
    }, csv);
    await page.waitForTimeout(200);

    const room = await page.evaluate(() => getRoomFromChart('MTH 8-1.G1.SCH', 'Monday', 3));
    expect(room).toBe('403');
  });

  test('Math.random is never used in any assignment or fairness logic', async ({ page }) => {
    // Picks are driven entirely by the weighted sort in assignCoverage; the
    // only legitimate use of Math.random in the whole app is generating a
    // unique id when a new teacher is added during Sync with Schedule.
    const fs = require('fs');
    const html = fs.readFileSync(APP_PATH, 'utf8');
    const matches = [...html.matchAll(/Math\.random/g)];
    expect(matches).toHaveLength(1);
  });

  test('course/room/teacher text is escaped on the output document, not inserted as raw HTML', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      setRoster([{ id: 't1', name: 'Jane <b>Smith</b>', tier: '1', highAvail: false, excluded: false,
        avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
        lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 }]);
      setLog([]);
      document.getElementById('run-date').value = '2026-06-01';
      renderAbsencesTable();
      const row = document.querySelector('#absences-tbody tr');
      row.querySelector('.abs-teacher').value = '__custom__';
      row.querySelector('.abs-teacher-custom').value = '<img src=x onerror=alert(1)>';
      row.querySelector('.abs-period').value = '1';
      row.querySelector('.abs-course').value = '<script>bad</script> Math';
      row.querySelector('.abs-section').value = '<b>M-1</b>';
      row.querySelector('.abs-room').value = '<i>101</i>';
      runCoverage();
    });

    // No actual <img>/<script>/<b>/<i> element should exist in the output —
    // everything from absence data must have come through as inert text.
    const hasRawTags = await page.evaluate(() =>
      !!document.querySelector('#output-doc img, #output-doc script, #output-doc b, #output-doc i'));
    expect(hasRawTags).toBe(false);

    // The text content should still show it, just as literal characters.
    const text = await page.evaluate(() => document.getElementById('output-doc').textContent);
    expect(text).toContain('<script>bad</script> Math');
    expect(text).toContain('Jane <b>Smith</b>');
  });
});
