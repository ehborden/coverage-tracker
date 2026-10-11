const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

test.describe('Override and Reset Day', () => {
  test('applyOverride moves the credit from the old teacher to the new one', async ({ page }) => {
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
        { id: 't3', name: 'Amy Lee', tier: '1', highAvail: false, excluded: false,
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

    const before = await page.evaluate(() => ({
      jane: getRoster().find(t => t.name === 'Jane Smith').totalCoverages,
      amy: getRoster().find(t => t.name === 'Amy Lee').totalCoverages,
    }));
    expect(before).toEqual({ jane: 1, amy: 0 });

    await page.evaluate(() => {
      document.getElementById('override-date').value = '2026-06-01';
      loadOverrideEntries();
      renderOverrideTable();
      const idx = _overrideEntries.findIndex(e => e.absentTeacher === 'Bob Jones' && e.period === 1);
      const sel = document.getElementById('override-new-' + idx);
      sel.innerHTML += '<option value="Amy Lee">Amy Lee</option>';
      sel.value = 'Amy Lee';
      applyOverride(idx, '2026-06-01');
    });

    const after = await page.evaluate(() => ({
      jane: getRoster().find(t => t.name === 'Jane Smith').totalCoverages,
      amy: getRoster().find(t => t.name === 'Amy Lee').totalCoverages,
      coveringTeacher: getLog()[0].coveringTeacher,
    }));
    expect(after).toEqual({ jane: 0, amy: 1, coveringTeacher: 'Amy Lee' });

    // Undo should put it right back.
    await page.evaluate(() => undoLastAction());
    const afterUndo = await page.evaluate(() => ({
      jane: getRoster().find(t => t.name === 'Jane Smith').totalCoverages,
      amy: getRoster().find(t => t.name === 'Amy Lee').totalCoverages,
      coveringTeacher: getLog()[0].coveringTeacher,
    }));
    expect(afterUndo).toEqual({ jane: 1, amy: 0, coveringTeacher: 'Jane Smith' });
  });

  test('Reset Day clears a date and rolls back totals; Undo restores it', async ({ page }) => {
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

    await page.evaluate(() => {
      document.getElementById('reset-date').value = '2026-06-01';
      confirmReset();
    });

    const afterReset = await page.evaluate(() => ({
      log: getLog(),
      jane: getRoster().find(t => t.name === 'Jane Smith').totalCoverages,
    }));
    expect(afterReset).toEqual({ log: [], jane: 0 });

    await page.evaluate(() => undoLastAction());
    const afterUndo = await page.evaluate(() => ({
      logLength: getLog().length,
      jane: getRoster().find(t => t.name === 'Jane Smith').totalCoverages,
    }));
    expect(afterUndo).toEqual({ logLength: 1, jane: 1 });
  });

  test('removeOverride clears the matching absence row too, so a later Run Coverage does not resurrect it', async ({ page }) => {
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

    expect(await page.evaluate(() => getLog().length)).toBe(1);
    expect(await page.evaluate(() => getAbsencesByDate('2026-06-01').length)).toBe(1);

    await page.evaluate(() => {
      document.getElementById('override-date').value = '2026-06-01';
      loadOverrideEntries();
      const idx = _overrideEntries.findIndex(e => e.absentTeacher === 'Bob Jones' && e.period === 1);
      removeOverride(idx, '2026-06-01');
    });

    expect(await page.evaluate(() => getLog().length)).toBe(0);
    expect(await page.evaluate(() => getAbsencesByDate('2026-06-01').length)).toBe(0);

    // Reload the Run Coverage screen's absences table for this date and
    // run again — nothing should come back, because the absence itself
    // (not just the assignment) is gone.
    await page.evaluate(() => { renderAbsencesTable(); runCoverage(); });
    expect(await page.evaluate(() => getLog().length)).toBe(0);
  });

  test('the output document refreshes automatically after an Override edit, without regenerating it manually', async ({ page }) => {
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

    const beforeText = await page.evaluate(() => document.getElementById('output-doc').textContent);
    expect(beforeText).toContain('Jane Smith');

    await page.evaluate(() => {
      document.getElementById('override-date').value = '2026-06-01';
      loadOverrideEntries();
      const idx = _overrideEntries.findIndex(e => e.absentTeacher === 'Bob Jones' && e.period === 1);
      resetOverride(idx, '2026-06-01');
    });

    // No call back to Run Coverage or renderOutput — resetOverride alone
    // should have refreshed the on-screen document to show UNASSIGNED.
    const afterText = await page.evaluate(() => document.getElementById('output-doc').textContent);
    expect(afterText).toContain('UNASSIGNED');
  });

  test('deleting an absence row that already has a coverage assignment removes the assignment too', async ({ page }) => {
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
      renderAbsencesTable(); // reload so the row reflects the saved absence, like a real visit would
    });

    expect(await page.evaluate(() => getLog().length)).toBe(1);

    await page.click('#absences-tbody tr .btn-danger');

    expect(await page.evaluate(() => getLog().length)).toBe(0);
    expect(await page.evaluate(() => getAbsencesByDate('2026-06-01').length)).toBe(0);
  });

  test('deleting an absence row with no coverage yet removed just removes the row, no confirm needed', async ({ page }) => {
    await gotoApp(page);
    let dialogCount = 0;
    page.on('dialog', d => { dialogCount++; d.accept(); });

    await page.evaluate(() => {
      document.getElementById('run-date').value = '2026-06-01';
      renderAbsencesTable();
      addAbsenceRow();
    });

    const rowCountBefore = await page.evaluate(() => document.querySelectorAll('#absences-tbody tr').length);
    await page.click('#absences-tbody tr:last-child .btn-danger');
    const rowCountAfter = await page.evaluate(() => document.querySelectorAll('#absences-tbody tr').length);

    expect(rowCountAfter).toBe(rowCountBefore - 1);
    expect(dialogCount).toBe(0);
  });

  test('navigating to the Override screen auto-loads today\'s assignments, no extra click needed', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      const today = todayStr();
      setRoster([{ id: 't1', name: 'Jane Smith', tier: '1', highAvail: false, excluded: false,
        avail: { Monday: [1], Tuesday: [1], Wednesday: [1], Thursday: [1], Friday: [1] },
        lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 }]);
      setLog([{ date: today, absentTeacher: 'X', period: 1, courseName: 'Math', coveringTeacher: 'Jane Smith' }]);
    });

    // showScreen alone, nothing else, should populate the table.
    await page.evaluate(() => showScreen('override'));

    const entriesText = await page.evaluate(() => document.getElementById('override-entries').textContent);
    expect(entriesText).toContain('Jane Smith');
    const dateValue = await page.evaluate(() => document.getElementById('override-date').value);
    const today = await page.evaluate(() => todayStr());
    expect(dateValue).toBe(today);
  });

  test('changing the date field on the Override screen auto-loads that date, no Load Assignments click needed', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      setRoster([{ id: 't1', name: 'Jane Smith', tier: '1', highAvail: false, excluded: false,
        avail: { Monday: [1], Tuesday: [1], Wednesday: [1], Thursday: [1], Friday: [1] },
        lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 }]);
      setLog([{ date: '2026-06-02', absentTeacher: 'X', period: 1, courseName: 'Math', coveringTeacher: 'Jane Smith' }]);
      showScreen('override'); // lands on today, which has nothing
    });

    expect(await page.evaluate(() => document.getElementById('override-entries').textContent)).not.toContain('Jane Smith');

    await page.fill('#override-date', '2026-06-02'); // fires the input's change event, same as a real pick

    const entriesText = await page.evaluate(() => document.getElementById('override-entries').textContent);
    expect(entriesText).toContain('Jane Smith');
  });
});
