const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

test.describe('Run Coverage (single day)', () => {
  test('assigns a substitute and credits totalCoverages/lastCoverageDate', async ({ page }) => {
    await gotoApp(page);

    await page.evaluate(() => {
      setRoster([
        { id: 't1', name: 'Jane Smith', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
        { id: 't2', name: 'Bob Jones', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
      ]);
      setLog([]);
      document.getElementById('run-date').value = '2026-06-01'; // a Monday
      renderAbsencesTable();
      const row = document.querySelector('#absences-tbody tr');
      row.querySelector('.abs-teacher').value = 'Bob Jones';
      row.querySelector('.abs-period').value = '1';
      row.querySelector('.abs-course').value = 'Math';
    });

    page.on('dialog', d => d.accept());
    await page.evaluate(() => runCoverage());

    const result = await page.evaluate(() => ({
      log: getLog(),
      jane: getRoster().find(t => t.name === 'Jane Smith'),
    }));

    expect(result.log).toHaveLength(1);
    expect(result.log[0].coveringTeacher).toBe('Jane Smith');
    // This is the core regression this suite guards: totals/dates used to
    // never update on a normal run (updateRosterAfterRun compared the
    // just-appended log entries against themselves).
    expect(result.jane.totalCoverages).toBe(1);
    expect(result.jane.lastCoverageDate).toBe('2026-06-01');
  });

  test('Undo reverses a run back to the prior state', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      setRoster([
        { id: 't1', name: 'Jane Smith', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
        { id: 't2', name: 'Bob Jones', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
      ]);
      setLog([]);
      document.getElementById('run-date').value = '2026-06-01';
      renderAbsencesTable();
      const row = document.querySelector('#absences-tbody tr');
      row.querySelector('.abs-teacher').value = 'Bob Jones';
      row.querySelector('.abs-period').value = '1';
      row.querySelector('.abs-course').value = 'Math';
      runCoverage();
    });

    const undoTitle = await page.getAttribute('#undo-btn', 'title');
    expect(undoTitle).toContain('Run Coverage');

    await page.evaluate(() => undoLastAction());

    const after = await page.evaluate(() => ({
      log: getLog(),
      jane: getRoster().find(t => t.name === 'Jane Smith'),
    }));
    expect(after.log).toHaveLength(0);
    expect(after.jane.totalCoverages).toBe(0);
    expect(after.jane.lastCoverageDate).toBe('');
  });

  test('the engine never books the same teacher twice in one day', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      setRoster([
        { id: 't1', name: 'Jane Smith', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1, 2], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
        { id: 't2', name: 'Bob Jones', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
        { id: 't3', name: 'Amy Lee', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [2], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
      ]);
      setLog([]);
      document.getElementById('run-date').value = '2026-06-01';
      renderAbsencesTable();
      const row1 = document.querySelector('#absences-tbody tr');
      row1.querySelector('.abs-teacher').value = 'Bob Jones';
      row1.querySelector('.abs-period').value = '1';
      row1.querySelector('.abs-course').value = 'Math';
      addAbsenceRow();
      const rows = document.querySelectorAll('#absences-tbody tr');
      const row2 = rows[rows.length - 1];
      row2.querySelector('.abs-teacher').value = 'Amy Lee';
      row2.querySelector('.abs-period').value = '2';
      row2.querySelector('.abs-course').value = 'Science';
      runCoverage();
    });

    const result = await page.evaluate(() => ({
      jane: getRoster().find(t => t.name === 'Jane Smith'),
      log: getLog(),
    }));
    // Jane is the only one free both periods. The engine picks her for
    // period 1, then usedToday excludes her from period 2, so Amy's
    // period goes unassigned rather than double-booking Jane.
    expect(result.jane.totalCoverages).toBe(1);
    expect(result.log.find(e => e.period === 2).coveringTeacher).toBe('⚠ UNASSIGNED');
  });

  test('updateRosterAfterRun credits a teacher once even if two new entries name them the same day', async ({ page }) => {
    // This exercises the dedup directly: usedToday stops the real engine
    // from ever producing two new same-day entries for one teacher (see
    // the test above), but updateRosterAfterRun must still be safe if it
    // were ever called with such a batch, e.g. a future manual-override
    // path. This guards that defensive behavior.
    await gotoApp(page);

    const result = await page.evaluate(() => {
      setRoster([
        { id: 't1', name: 'Jane Smith', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1, 2], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
      ]);
      const dateStr = '2026-06-01';
      const entries = [
        { date: dateStr, absentTeacher: 'Bob Jones', period: 1, coveringTeacher: 'Jane Smith' },
        { date: dateStr, absentTeacher: 'Amy Lee', period: 2, coveringTeacher: 'Jane Smith' },
      ];
      setLog(entries);
      updateRosterAfterRun(entries, dateStr);
      return getRoster().find(t => t.name === 'Jane Smith');
    });

    expect(result.totalCoverages).toBe(1);
  });
});
