const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

test.describe('MS/subject-aware coverage picks (derived from the Schedule CSV)', () => {
  test('the Subject column splits into level + subject; non-subject blocks (Advisory, UNSCHD, etc) are left blank', async ({ page }) => {
    await gotoApp(page);

    const csv = 'Teacher,Class ID,Description,Meeting Times,Status,Subject\n'
      + 'Jane Smith,M-1,Algebra,M-1,Active,MS: Mathematics\n'
      + 'Jane Smith,A-1,Advisory,M-2,Active,Advisory\n'
      + 'Bob Jones,S-1,Biology,M-1,Active,US: Science\n'
      + 'Pat Lee,U-1,Study Hall,M-1,Active,Study Hall\n'
      + 'Sam Fox,X-1,Nothing,M-1,Active,UNSCHD\n';

    await page.evaluate((csvText) => {
      const file = new File([csvText], 'schedule.csv', { type: 'text/csv' });
      loadScheduleCSV({ target: { files: [file], value: '' } });
    }, csv);
    await page.waitForTimeout(200);

    const result = await page.evaluate(() => ({
      jane: scheduledClassFor('Jane Smith', 'Monday', 1),
      janeAdvisory: scheduledClassFor('Jane Smith', 'Monday', 2),
      bob: scheduledClassFor('Bob Jones', 'Monday', 1),
      patStudyHall: scheduledClassFor('Pat Lee', 'Monday', 1),
      samUnscheduled: scheduledClassFor('Sam Fox', 'Monday', 1),
    }));

    expect(result.jane).toEqual(expect.objectContaining({ level: 'MS', subject: 'Mathematics' }));
    expect(result.janeAdvisory).toEqual(expect.objectContaining({ level: null, subject: null }));
    expect(result.bob).toEqual(expect.objectContaining({ level: 'US', subject: 'Science' }));
    expect(result.patStudyHall).toEqual(expect.objectContaining({ level: null, subject: null }));
    expect(result.samUnscheduled).toEqual(expect.objectContaining({ level: null, subject: null }));
  });

  test('a teacher\'s own level and subjects are derived from their real schedule, not set anywhere by hand', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => {
      scheduleData = {
        'MS Teacher': [
          { day: 'Monday', period: 1, courseName: 'Algebra', section: '', room: '', level: 'MS', subject: 'Mathematics' },
          { day: 'Monday', period: 2, courseName: 'Advisory', section: '', room: '' }, // no level/subject — doesn't count
          { day: 'Tuesday', period: 1, courseName: 'Geometry', section: '', room: '', level: 'MS', subject: 'Mathematics' },
        ],
        'HS Teacher': [
          { day: 'Monday', period: 1, courseName: 'Biology', section: '', room: '', level: 'US', subject: 'Science' },
          { day: 'Monday', period: 3, courseName: 'Chemistry', section: '', room: '', level: 'US', subject: 'Science' },
        ],
        'No Schedule Info': [
          { day: 'Monday', period: 1, courseName: 'Study Hall', section: '', room: '' },
        ],
      };
    });

    const result = await page.evaluate(() => ({
      msLevel: teacherLevel('MS Teacher'),
      msSubjects: [...teacherSubjects('MS Teacher')],
      hsLevel: teacherLevel('HS Teacher'),
      hsSubjects: [...teacherSubjects('HS Teacher')],
      unknownLevel: teacherLevel('No Schedule Info'),
      neverLoadedLevel: teacherLevel('Nobody At All'),
    }));

    expect(result.msLevel).toBe('MS');
    expect(result.msSubjects).toEqual(['Mathematics']);
    expect(result.hsLevel).toBe('US');
    expect(result.hsSubjects).toEqual(['Science']);
    expect(result.unknownLevel).toBeNull();
    expect(result.neverLoadedLevel).toBeNull();
  });

  test('an MS-tagged teacher is preferred for an MS class when fairness is otherwise tied, but a clearly fairer pick still wins regardless', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      // Both equally eligible by every existing fairness factor (same tier,
      // same weekly count, no prior coverage) — only the MS tie-breaker differs.
      setRoster([
        { id: 't1', name: 'MS Match', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
        { id: 't2', name: 'No Match', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
      ]);
      setLog([]);
      scheduleData = {
        'Absent Teacher': [{ day: 'Monday', period: 1, courseName: 'Algebra', section: '', room: '', level: 'MS', subject: 'Mathematics' }],
        'MS Match': [{ day: 'Tuesday', period: 1, courseName: 'Geometry', section: '', room: '', level: 'MS', subject: 'Mathematics' }],
        'No Match': [{ day: 'Tuesday', period: 1, courseName: 'Lit', section: '', room: '', level: 'US', subject: 'English' }],
      };
      document.getElementById('run-date').value = '2026-06-01'; // a Monday
      renderAbsencesTable();
      const row = document.querySelector('#absences-tbody tr');
      row.querySelector('.abs-teacher').value = '__custom__';
      row.querySelector('.abs-teacher-custom').value = 'Absent Teacher';
      row.querySelector('.abs-period').value = '1';
      row.querySelector('.abs-course').value = 'Algebra';
      runCoverage();
    });

    expect(await page.evaluate(() => getLog()[0].coveringTeacher)).toBe('MS Match');

    // Now make "No Match" the clearly fairer pick (way more capacity, never
    // covered) — the MS tie-breaker must not be strong enough to beat that.
    await page.evaluate(() => {
      setLog([]);
      const roster = getRoster();
      roster.find(t => t.name === 'No Match').avail.Monday = [1, 2, 3, 4, 5];
      roster.find(t => t.name === 'MS Match').avail.Monday = [1];
      setRoster(roster);
      runCoverage();
    });
    expect(await page.evaluate(() => getLog()[0].coveringTeacher)).toBe('No Match');
  });

  test('a subject-matched teacher is preferred for a high-school class when fairness is otherwise tied', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      setRoster([
        { id: 't1', name: 'Subject Match', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
        { id: 't2', name: 'No Match', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
      ]);
      setLog([]);
      scheduleData = {
        'Absent Teacher': [{ day: 'Monday', period: 1, courseName: 'Chemistry', section: '', room: '', level: 'US', subject: 'Science' }],
        'Subject Match': [{ day: 'Tuesday', period: 1, courseName: 'Biology', section: '', room: '', level: 'US', subject: 'Science' }],
        'No Match': [{ day: 'Tuesday', period: 1, courseName: 'Lit', section: '', room: '', level: 'US', subject: 'English' }],
      };
      document.getElementById('run-date').value = '2026-06-01'; // a Monday
      renderAbsencesTable();
      const row = document.querySelector('#absences-tbody tr');
      row.querySelector('.abs-teacher').value = '__custom__';
      row.querySelector('.abs-teacher-custom').value = 'Absent Teacher';
      row.querySelector('.abs-period').value = '1';
      row.querySelector('.abs-course').value = 'Chemistry';
      runCoverage();
    });

    expect(await page.evaluate(() => getLog()[0].coveringTeacher)).toBe('Subject Match');
  });

  test('a matched pick says so in its hover reason, so it can be checked from the output screen without reading code', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      setRoster([{ id: 't1', name: 'MS Match', tier: '1', highAvail: false, excluded: false,
        avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
        lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 }]);
      setLog([]);
      scheduleData = {
        'Absent Teacher': [{ day: 'Monday', period: 1, courseName: 'Algebra', section: '', room: '', level: 'MS', subject: 'Mathematics' }],
        'MS Match': [{ day: 'Tuesday', period: 1, courseName: 'Geometry', section: '', room: '', level: 'MS', subject: 'Mathematics' }],
      };
      document.getElementById('run-date').value = '2026-06-01'; // a Monday
      renderAbsencesTable();
      const row = document.querySelector('#absences-tbody tr');
      row.querySelector('.abs-teacher').value = '__custom__';
      row.querySelector('.abs-teacher-custom').value = 'Absent Teacher';
      row.querySelector('.abs-period').value = '1';
      row.querySelector('.abs-course').value = 'Algebra';
      runCoverage();
    });

    expect(await page.evaluate(() => getLog()[0].assignReason)).toContain('MS match');
    // Also visible on the actual output document, not just the log entry.
    const tooltipText = await page.evaluate(() => document.querySelector('.assign-reason')?.dataset.reason);
    expect(tooltipText).toContain('MS match');
  });
});
