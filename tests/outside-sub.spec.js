const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

test.describe('Outside sub period exclusions and MS avoidance', () => {
  test('a period checked off for an outside sub is never assigned to them', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      setRoster([]); // no staff at all, so the only possible outcomes are "Outside Sub" or UNASSIGNED
      setLog([]);
      document.getElementById('run-date').value = '2026-06-01';
      renderAbsencesTable(); // reads the (not yet set) saved count for this date first
      document.getElementById('outside-sub-count').value = '1';
      const row = document.querySelector('#absences-tbody tr');
      row.querySelector('.abs-teacher').value = '__custom__';
      row.querySelector('.abs-teacher-custom').value = 'X';
      row.querySelector('.abs-period').value = '7';
      row.querySelector('.abs-course').value = 'Math';
      setOutsideSubUnavail('2026-06-01', { 'Outside Sub': [7] });
      runCoverage();
    });

    expect(await page.evaluate(() => getLog()[0].coveringTeacher)).toBe('⚠ UNASSIGNED');

    // Same setup, no exclusion this time — period 7 should go to the outside sub.
    await page.evaluate(() => {
      setLog([]);
      setOutsideSubUnavail('2026-06-01', {});
      runCoverage();
    });
    expect(await page.evaluate(() => getLog()[0].coveringTeacher)).toBe('Outside Sub');
  });

  test('outside subs are only given a middle-school (6-8) period when nothing else is left for that period', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      setRoster([]); // forces every period down to "Outside Sub or UNASSIGNED"
      setLog([]);
      document.getElementById('run-date').value = '2026-06-01';
      renderAbsencesTable();
      document.getElementById('outside-sub-count').value = '1'; // only one slot for period 3
      const rows = document.querySelectorAll('#absences-tbody tr');
      rows[0].querySelector('.abs-teacher').value = '__custom__';
      rows[0].querySelector('.abs-teacher-custom').value = 'HS Teacher';
      rows[0].querySelector('.abs-period').value = '3';
      rows[0].querySelector('.abs-course').value = 'Algebra';
      rows[0].querySelector('.abs-section').value = '10'; // high school section
      addAbsenceRow();
      const row2 = document.querySelectorAll('#absences-tbody tr')[1];
      row2.querySelector('.abs-teacher').value = '__custom__';
      row2.querySelector('.abs-teacher-custom').value = 'MS Teacher';
      row2.querySelector('.abs-period').value = '3'; // same period — only one can get the single sub slot
      row2.querySelector('.abs-course').value = 'Science';
      row2.querySelector('.abs-section').value = '7'; // middle school section
      runCoverage();
    });

    const result = await page.evaluate(() => {
      const log = getLog();
      return {
        hs: log.find(e => e.absentTeacher === 'HS Teacher').coveringTeacher,
        ms: log.find(e => e.absentTeacher === 'MS Teacher').coveringTeacher,
      };
    });
    expect(result.hs).toBe('Outside Sub');
    expect(result.ms).toBe('⚠ UNASSIGNED');
  });

  test('explicitly marking two same-period absences as "Outside Sub" rotates them across slots instead of both landing on slot 1', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      setRoster([]);
      setLog([]);
      document.getElementById('run-date').value = '2026-06-01';
      renderAbsencesTable();
      document.getElementById('outside-sub-count').value = '2';
      const rows = document.querySelectorAll('#absences-tbody tr');
      rows[0].querySelector('.abs-teacher').value = '__custom__';
      rows[0].querySelector('.abs-teacher-custom').value = 'A';
      rows[0].querySelector('.abs-period').value = '2';
      rows[0].querySelector('.abs-type').value = 'outside';
      addAbsenceRow();
      const row2 = document.querySelectorAll('#absences-tbody tr')[1];
      row2.querySelector('.abs-teacher').value = '__custom__';
      row2.querySelector('.abs-teacher-custom').value = 'B';
      row2.querySelector('.abs-period').value = '2'; // same period as A
      row2.querySelector('.abs-type').value = 'outside';
      runCoverage();
    });

    const result = await page.evaluate(() => {
      const log = getLog();
      return {
        a: log.find(e => e.absentTeacher === 'A').coveringTeacher,
        b: log.find(e => e.absentTeacher === 'B').coveringTeacher,
      };
    });
    expect([result.a, result.b].sort()).toEqual(['Outside Sub 1', 'Outside Sub 2']);
  });

  test('the Outside Subs Coming availability checkboxes show, hide, and persist per date', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      document.getElementById('run-date').value = '2026-06-01';
      renderAbsencesTable();
    });

    // 0 outside subs: no checkboxes at all.
    expect(await page.evaluate(() => document.getElementById('outside-sub-avail-area').innerHTML.trim())).toBe('');

    // Switch to 2: two rows of checkboxes appear, correctly labeled.
    await page.selectOption('#outside-sub-count', '2');
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('#outside-sub-avail-area > div > span')].map(s => s.textContent));
    expect(labels).toEqual(["Outside Sub 1 can't cover:", "Outside Sub 2 can't cover:"]);

    // Check period 7 off for Outside Sub 1 only.
    await page.check('#outside-sub-avail-area input[data-label="Outside Sub 1"][data-period="7"]');
    expect(await page.evaluate(() => getOutsideSubUnavail('2026-06-01'))).toEqual({ 'Outside Sub 1': [7] });

    // Switching dates away and back reloads the right thing for each date.
    await page.fill('#run-date', '2026-06-02');
    expect(await page.evaluate(() => document.getElementById('outside-sub-avail-area').innerHTML.trim())).toBe('');
    await page.fill('#run-date', '2026-06-01');
    expect(await page.evaluate(() => document.querySelector('#outside-sub-avail-area input[data-label="Outside Sub 1"][data-period="7"]').checked)).toBe(true);
  });
  test('an outside sub takes the high school class over a middle school one in the same period, with real "SUBJ GRADE-SECTION" codes', async ({ page }) => {
    await gotoApp(page);
    const picks = await page.evaluate(() => {
      setRoster([]); setLog([]);
      const ab = (t, sec) => ({ absentTeacher: t, period: 1, courseName: 'English', sectionNumber: sec, roomNumber: '', absType: 'normal' });
      const run = (list) => { setLog([]); return Object.fromEntries(assignCoverage(list, '2026-10-14', 1).newEntries.map(e => [e.sectionNumber, e.coveringTeacher])); };
      return [
        run([ab('A', 'ENG 7-1'), ab('B', 'ENG 10-1')]),
        run([ab('B', 'ENG 10-1'), ab('A', 'ENG 7-1')]),
        run([ab('A', 'SCI 6/7-2'), ab('B', 'SCI 11-3')]),
      ];
    });
    expect(picks[0]['ENG 10-1']).toBe('Outside Sub');
    expect(picks[1]['ENG 10-1']).toBe('Outside Sub');
    expect(picks[2]['SCI 11-3']).toBe('Outside Sub');
  });
});
