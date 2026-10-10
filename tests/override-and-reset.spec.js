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
});
