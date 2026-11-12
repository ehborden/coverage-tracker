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

  test('a period is not left UNASSIGNED when moving an earlier pick from the same run would cover both', async ({ page }) => {
    await gotoApp(page);
    const mk = (id, name, avail, extra = {}) => ({ id, name, tier: '1', highAvail: false, excluded: false,
      avail: Object.assign({ Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] }, avail),
      lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0, ...extra });
    // Avery is free periods 1 and 5, Blake only period 1. Row order puts
    // period 1 first, and Avery (more free periods) is the first pick for
    // it, which used to leave period 5 with nobody while Blake sat unused.
    const result = await page.evaluate((roster) => {
      setRoster(roster);
      const row = (teacher, period) => ({ absentTeacher: teacher, period, courseName: 'Class', sectionNumber: '', roomNumber: '', absType: 'normal' });
      const out = assignCoverage([row('Dana Wells', 1), row('Eli Park', 5)], '2026-06-01', 0); // a Monday
      return { picks: out.assignments.map(e => `P${e.period}:${e.coveringTeacher}`), unassigned: out.unassigned.length };
    }, [mk('a', 'Avery Stone', { Monday: [1, 5] }), mk('b', 'Blake Marsh', { Monday: [1] })]);
    expect(result.unassigned).toBe(0);
    expect(result.picks.sort()).toEqual(['P1:Blake Marsh', 'P5:Avery Stone']);
  });

  test('when every period can be covered anyway, picks are not rearranged', async ({ page }) => {
    await gotoApp(page);
    const mk = (id, name, avail, extra = {}) => ({ id, name, tier: '1', highAvail: false, excluded: false,
      avail: Object.assign({ Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] }, avail),
      lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0, ...extra });
    // Same two absences plus Casey, who can take period 5: nothing would go
    // unassigned, so Avery keeps period 1 (the fairness pick).
    const picks = await page.evaluate((roster) => {
      setRoster(roster);
      const row = (teacher, period) => ({ absentTeacher: teacher, period, courseName: 'Class', sectionNumber: '', roomNumber: '', absType: 'normal' });
      return assignCoverage([row('Dana Wells', 1), row('Eli Park', 5)], '2026-06-01', 0).assignments.map(e => `P${e.period}:${e.coveringTeacher}`);
    }, [mk('a', 'Avery Stone', { Monday: [1, 5] }), mk('b', 'Blake Marsh', { Monday: [1] }), mk('c', 'Casey Lund', { Monday: [5] })]);
    expect(picks.sort()).toEqual(['P1:Avery Stone', 'P5:Casey Lund']);
  });
});
