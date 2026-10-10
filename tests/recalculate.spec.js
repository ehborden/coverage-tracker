const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

test.describe('Recalculate from Log', () => {
  test('rebuilds totalCoverages, lastCoverageDate, and previousCoverageDate from the real log', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    const result = await page.evaluate(() => {
      setRoster([
        { id: 't1', name: 'Jane Smith', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [1], Wednesday: [1], Thursday: [], Friday: [] },
          lastCoverageDate: '2020-01-01', previousCoverageDate: '', totalCoverages: 999 },
        { id: 't2', name: 'Nobody Covered', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '2020-01-01', previousCoverageDate: '', totalCoverages: 5 },
      ]);
      setLog([
        { date: '2026-06-01', absentTeacher: 'X', period: 1, courseName: 'Y', coveringTeacher: 'Jane Smith' },
        { date: '2026-06-03', absentTeacher: 'X', period: 1, courseName: 'Y', coveringTeacher: 'Jane Smith' },
        { date: '2026-06-03', absentTeacher: 'Z', period: 2, courseName: 'Y', coveringTeacher: 'Jane Smith' }, // same date, 2nd period -> still 1 unique date
        { date: '2026-06-10', absentTeacher: 'X', period: 1, courseName: 'Y', coveringTeacher: 'Jane Smith' },
      ]);

      recalculateCoveragesFromLog();

      const roster = getRoster();
      return {
        jane: roster.find(t => t.name === 'Jane Smith'),
        nobody: roster.find(t => t.name === 'Nobody Covered'),
      };
    });

    expect(result.jane.totalCoverages).toBe(3);
    expect(result.jane.lastCoverageDate).toBe('2026-06-10');
    expect(result.jane.previousCoverageDate).toBe('2026-06-03');
    // A teacher with stale roster values but zero real log entries resets cleanly.
    expect(result.nobody).toEqual(expect.objectContaining({ totalCoverages: 0, lastCoverageDate: '', previousCoverageDate: '' }));

    await page.evaluate(() => undoLastAction());
    const afterUndo = await page.evaluate(() => getRoster().find(t => t.name === 'Jane Smith'));
    expect(afterUndo).toEqual(expect.objectContaining({ totalCoverages: 999, lastCoverageDate: '2020-01-01' }));
  });
});
