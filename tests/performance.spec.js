const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

// This app is well within comfortable margins at realistic scale (a few
// hundred staff at most, a few thousand log entries across years). These
// thresholds are ~10x the measured times at a deliberately oversized
// dataset, so this guards against a future change introducing a real
// regression (e.g. an accidental O(n^2) scan) without being flaky over
// normal machine variance.
test.describe('Performance (stress test, not a real-world scale)', () => {
  test('render and assignment functions stay fast with 300 teachers / 3000 log entries', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    const timings = await page.evaluate(() => {
      const DAYS_ = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
      const PERIODS_ = [1,2,3,4,5,6,7];

      const roster = [];
      for (let i = 0; i < 300; i++) {
        const avail = {};
        DAYS_.forEach(d => { avail[d] = PERIODS_.filter(() => Math.random() < 0.3); });
        roster.push({
          id: 't' + i, name: `Teacher ${i}`, tier: ['1','1','1','2','3'][i % 5],
          highAvail: i % 10 === 0, excluded: false, avail,
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: Math.floor(Math.random() * 50),
        });
      }
      setRoster(roster);

      const log = [];
      for (let i = 0; i < 3000; i++) {
        const d = new Date(2024, 8, 1 + Math.floor(i / 8));
        log.push({
          date: d.toISOString().slice(0, 10),
          absentTeacher: `Teacher ${(i * 3) % 300}`,
          period: PERIODS_[i % 7],
          courseName: 'Course ' + i,
          sectionNumber: 'SEC-' + i,
          roomNumber: String(100 + (i % 20)),
          absType: 'normal',
          coveringTeacher: `Teacher ${(i * 7) % 300}`,
          assignReason: 'Tier 1 · 0 coverages this week · Last: never · Total: 0',
        });
      }
      setLog(log);

      const time = (label, fn) => {
        const start = performance.now();
        fn();
        return { label, ms: performance.now() - start };
      };

      const results = {};
      results.renderRoster = time('renderRoster', () => { showScreen('roster'); renderRoster(); }).ms;
      results.renderLog = time('renderLog', () => { showScreen('log'); renderLog(); }).ms;
      results.renderSummary = time('renderSummary', () => { showScreen('summary'); renderSummary(); }).ms;
      results.renderWeeklyGrid = time('renderWeeklyGrid', () => renderWeeklyGrid()).ms;
      results.recalculateCoveragesFromLog = time('recalculateCoveragesFromLog', () => recalculateCoveragesFromLog()).ms;
      return results;
    });

    expect(timings.renderRoster).toBeLessThan(500);
    expect(timings.renderLog).toBeLessThan(800);
    expect(timings.renderSummary).toBeLessThan(500);
    expect(timings.renderWeeklyGrid).toBeLessThan(500);
    expect(timings.recalculateCoveragesFromLog).toBeLessThan(1000);
  });

  test('running coverage for many simultaneous absences against a large pool stays fast', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    const ms = await page.evaluate(() => {
      const DAYS_ = ['Monday','Tuesday','Wednesday','Thursday','Friday'];
      const PERIODS_ = [1,2,3,4,5,6,7];
      const roster = [];
      for (let i = 0; i < 300; i++) {
        const avail = {};
        DAYS_.forEach(d => { avail[d] = PERIODS_.filter(() => Math.random() < 0.3); });
        roster.push({ id: 't' + i, name: `Teacher ${i}`, tier: '1', highAvail: false, excluded: false,
          avail, lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 });
      }
      setRoster(roster);
      setLog([]);

      document.getElementById('run-date').value = '2026-06-01';
      renderAbsencesTable();
      for (let i = 0; i < 15; i++) {
        if (i > 0) addAbsenceRow();
        const rows = document.querySelectorAll('#absences-tbody tr');
        const row = rows[rows.length - 1];
        row.querySelector('.abs-teacher').value = '__custom__';
        row.querySelector('.abs-teacher').dispatchEvent(new Event('change'));
        row.querySelector('.abs-teacher-custom').value = 'Absent ' + i;
        row.querySelector('.abs-period').value = String((i % 7) + 1);
        row.querySelector('.abs-course').value = 'Math';
      }

      const start = performance.now();
      runCoverage();
      return performance.now() - start;
    });

    expect(ms).toBeLessThan(500);
  });
});
