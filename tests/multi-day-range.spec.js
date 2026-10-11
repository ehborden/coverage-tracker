const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

test.describe('Multi-day range ("End Date (for range)")', () => {
  test('spreads coverage across different teachers as weekly counts accumulate', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      setRoster([
        { id: 't1', name: 'Jane Smith', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [1], Wednesday: [1], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
        { id: 't2', name: 'Bob Jones', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [1], Wednesday: [1], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
        { id: 't3', name: 'Amy Lee', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [1], Wednesday: [1], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
      ]);
      setLog([]);
      // Pre-existing, unrelated absence already saved on the last day,
      // to confirm the range merge doesn't clobber it.
      setData('cs_absences_2026-06-03', [{ teacher: 'Amy Lee', period: 1, course: 'Pre-existing', section: '', room: '', noCoverage: false, absType: 'normal' }]);

      document.getElementById('run-date').value = '2026-06-01'; // Monday
      document.getElementById('run-date-end').value = '2026-06-03'; // Wednesday
      renderAbsencesTable();
      const row = document.querySelector('#absences-tbody tr');
      row.querySelector('.abs-teacher').value = 'Bob Jones';
      row.querySelector('.abs-period').value = '1';
      row.querySelector('.abs-course').value = 'Math';
      runCoverage();
    });

    const result = await page.evaluate(() => ({
      log: getLog(),
      endDateCleared: document.getElementById('run-date-end').value,
      undoTitle: document.getElementById('undo-btn').title,
    }));

    expect(result.endDateCleared).toBe('');
    expect(result.undoTitle).toContain('2026-06-01 to 2026-06-03');

    const byDate = Object.fromEntries(result.log.map(e => [`${e.date}-${e.absentTeacher}`, e.coveringTeacher]));
    expect(byDate['2026-06-01-Bob Jones']).toBe('Jane Smith');
    // Jane already covered Monday, so Tuesday goes to someone fresh.
    expect(byDate['2026-06-02-Bob Jones']).toBe('Amy Lee');
    // Wednesday's pre-existing absence survived the merge and got covered too.
    expect(byDate['2026-06-03-Amy Lee']).toBeTruthy();

    // One Undo reverses the whole range in a single click.
    await page.evaluate(() => undoLastAction());
    const afterUndo = await page.evaluate(() => getLog());
    expect(afterUndo).toHaveLength(0);
  });

  test('pulls each day\'s real class from the schedule instead of copying day one', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      setRoster([
        { id: 't1', name: 'Jane Smith', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [1], Wednesday: [1], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
        { id: 't2', name: 'Bob Jones', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [1], Wednesday: [1], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
      ]);
      setLog([]);
      // Bob's real schedule: Monday P1 = Math, Tuesday P1 = Science (a
      // different class, same period), no Wednesday P1 class at all (a
      // genuine free period).
      scheduleData = {
        'Bob Jones': [
          { day: 'Monday', period: 1, courseName: 'Math', section: 'M-1', room: '101' },
          { day: 'Tuesday', period: 1, courseName: 'Science', section: 'S-1', room: '202' },
        ],
      };
      saveScheduleToStorage();

      document.getElementById('run-date').value = '2026-06-01';
      document.getElementById('run-date-end').value = '2026-06-03';
      renderAbsencesTable();
      const row = document.querySelector('#absences-tbody tr');
      row.querySelector('.abs-teacher').value = 'Bob Jones';
      row.querySelector('.abs-period').value = '1';
      row.querySelector('.abs-course').value = 'Math';
      row.querySelector('.abs-section').value = 'M-1';
      row.querySelector('.abs-room').value = '101';
      runCoverage();
    });

    const log = await page.evaluate(() => getLog().map(e => ({ date: e.date, courseName: e.courseName, sectionNumber: e.sectionNumber })));
    expect(log).toHaveLength(2); // Wednesday is a confirmed free period: no row at all
    expect(log.find(e => e.date === '2026-06-01').courseName).toBe('Math');
    expect(log.find(e => e.date === '2026-06-02').courseName).toBe('Science'); // pulled from the real schedule, not copied
  });

  test('a teacher absent all day with a genuine free period still can\'t cover someone else that day', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      // Bob is out Mon-Tue. His only listed row is period 1. Tuesday he
      // also has period 3 open (a real free period per the schedule), but
      // he is still out sick that whole day and must not be assignable
      // to cover Amy's period-3 need on Tuesday.
      setRoster([
        { id: 't1', name: 'Bob Jones', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [1, 3], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
        { id: 't2', name: 'Jane Smith', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [1, 3], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 5 }, // deliberately a worse fairness pick
        { id: 't3', name: 'Amy Lee', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [], Tuesday: [3], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
      ]);
      setLog([]);
      scheduleData = { 'Bob Jones': [{ day: 'Monday', period: 1, courseName: 'Math', section: 'M-1', room: '101' }] };
      saveScheduleToStorage();

      document.getElementById('run-date').value = '2026-06-01';
      document.getElementById('run-date-end').value = '2026-06-02';
      renderAbsencesTable();
      const row = document.querySelector('#absences-tbody tr');
      row.querySelector('.abs-teacher').value = 'Bob Jones';
      row.querySelector('.abs-period').value = '1';
      row.querySelector('.abs-course').value = 'Math';

      setData('cs_absences_2026-06-02', [{ teacher: 'Amy Lee', period: 3, course: 'Art', section: '', room: '', noCoverage: false, absType: 'normal' }]);
      runCoverage();
    });

    const log = await page.evaluate(() => getLog().map(e => ({ date: e.date, absentTeacher: e.absentTeacher, period: e.period, coveringTeacher: e.coveringTeacher })));
    const tuesdayAmy = log.find(e => e.date === '2026-06-02' && e.absentTeacher === 'Amy Lee');
    // Jane picks it up, not Bob, even though Jane has a worse fairness
    // score, because Bob is correctly excluded for being absent that day.
    expect(tuesdayAmy.coveringTeacher).toBe('Jane Smith');
  });

  test('a teacher with a genuinely different set of periods each day gets each day\'s real periods, not day one\'s period numbers repeated', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      setRoster([
        { id: 't1', name: 'Jane Smith', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [2, 4], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
      ]);
      setLog([]);
      // Bob's real schedule: only period 1 on Monday, but periods 2 AND 4
      // on Tuesday — a different count and different period numbers, not
      // just a different course in the same period.
      scheduleData = {
        'Bob Jones': [
          { day: 'Monday', period: 1, courseName: 'Math', section: 'M-1', room: '101' },
          { day: 'Tuesday', period: 2, courseName: 'Science', section: 'S-1', room: '202' },
          { day: 'Tuesday', period: 4, courseName: 'Science Lab', section: 'S-1L', room: '203' },
        ],
      };
      saveScheduleToStorage();

      document.getElementById('run-date').value = '2026-06-01'; // Monday
      document.getElementById('run-date-end').value = '2026-06-02'; // Tuesday
      renderAbsencesTable();
      // Day one is typed exactly as Bob's real Monday: just period 1.
      const row = document.querySelector('#absences-tbody tr');
      row.querySelector('.abs-teacher').value = 'Bob Jones';
      row.querySelector('.abs-period').value = '1';
      row.querySelector('.abs-course').value = 'Math';
      runCoverage();
    });

    const log = await page.evaluate(() => getLog()
      .filter(e => e.absentTeacher === 'Bob Jones')
      .map(e => ({ date: e.date, period: e.period, courseName: e.courseName })));

    const monday = log.filter(e => e.date === '2026-06-01');
    const tuesday = log.filter(e => e.date === '2026-06-02').sort((a, b) => a.period - b.period);

    expect(monday).toEqual([{ date: '2026-06-01', period: 1, courseName: 'Math' }]);
    // Tuesday picks up BOTH of Bob's real periods (2 and 4) — not period 1
    // repeated, and not just one of them.
    expect(tuesday).toEqual([
      { date: '2026-06-02', period: 2, courseName: 'Science' },
      { date: '2026-06-02', period: 4, courseName: 'Science Lab' },
    ]);
  });

  test('a teacher with no classes at all on a later day is still marked absent (can\'t cover anyone else) even though nothing needs covering that day', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      setRoster([
        { id: 't1', name: 'Bob Jones', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [3], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 }, // would otherwise be the fairer pick
        { id: 't2', name: 'Jane Smith', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [], Tuesday: [3], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 5 },
        { id: 't3', name: 'Amy Lee', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [], Tuesday: [3], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 }, // needs covering, not covering
      ]);
      setLog([]);
      // Bob only has a Monday class — Tuesday he genuinely has nothing
      // scheduled (not a missing-from-the-CSV case, a real day with zero
      // classes), yet he's still out sick that day per the absence range.
      scheduleData = { 'Bob Jones': [{ day: 'Monday', period: 1, courseName: 'Math', section: '', room: '' }] };
      saveScheduleToStorage();

      document.getElementById('run-date').value = '2026-06-01';
      document.getElementById('run-date-end').value = '2026-06-02';
      renderAbsencesTable();
      const row = document.querySelector('#absences-tbody tr');
      row.querySelector('.abs-teacher').value = 'Bob Jones';
      row.querySelector('.abs-period').value = '1';
      row.querySelector('.abs-course').value = 'Math';

      // A separate, unrelated Tuesday absence that needs covering.
      setData('cs_absences_2026-06-02', [{ teacher: 'Amy Lee', period: 3, course: 'Art', section: '', room: '', noCoverage: false, absType: 'normal' }]);
      runCoverage();
    });

    const log = await page.evaluate(() => getLog().map(e => ({ date: e.date, absentTeacher: e.absentTeacher, period: e.period, coveringTeacher: e.coveringTeacher })));
    // No coverage entry logged for Bob on Tuesday — he had nothing scheduled.
    expect(log.some(e => e.date === '2026-06-02' && e.absentTeacher === 'Bob Jones')).toBe(false);
    // Jane picks it up, not Bob, even though Bob has a better fairness
    // score (0 vs 5 total), because Bob is correctly excluded for being
    // out that whole day — even with zero real periods to anchor it to.
    const amyEntry = log.find(e => e.date === '2026-06-02' && e.absentTeacher === 'Amy Lee');
    expect(amyEntry.coveringTeacher).toBe('Jane Smith');
  });

  test('a teacher not in the loaded schedule at all falls back and is flagged, not silently dropped', async ({ page }) => {
    await gotoApp(page);
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });

    await page.evaluate(() => {
      setRoster([
        { id: 't1', name: 'Jane Smith', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [1], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
        { id: 't2', name: 'Bob Jones', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [1], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
      ]);
      setLog([]);
      // scheduleData loaded, but Bob isn't in it at all.
      scheduleData = { 'Someone Else': [{ day: 'Monday', period: 1, courseName: 'Art', section: '', room: '' }] };
      saveScheduleToStorage();

      document.getElementById('run-date').value = '2026-06-01';
      document.getElementById('run-date-end').value = '2026-06-02';
      renderAbsencesTable();
      const row = document.querySelector('#absences-tbody tr');
      row.querySelector('.abs-teacher').value = 'Bob Jones';
      row.querySelector('.abs-period').value = '1';
      row.querySelector('.abs-course').value = 'Math';
      runCoverage();
    });

    const log = await page.evaluate(() => getLog().map(e => ({ date: e.date, courseName: e.courseName })));
    expect(log).toHaveLength(2); // falls back to copying day one, not dropped
    expect(log.every(e => e.courseName === 'Math')).toBe(true);
    expect(dialogs.some(m => m.includes("aren't in the loaded schedule"))).toBe(true);
  });
});
