const { test, expect } = require('@playwright/test');
const { gotoApp, makeGithubStore, installGithubMock, connectDeviceToSync, waitForSyncIdle } = require('./helpers');

const MONDAY = '2026-06-01';

// Seeds a roster where nobody has a regular free period 3 except whoever
// the test gives one, plus a schedule with a 9th grade class, a 10th grade
// class and a combined 6/7 class all meeting Monday period 3.
async function seedGradeOutDay(page) {
  await page.evaluate(() => {
    const teacher = (id, name, mondayFree) => ({
      id, name, tier: '1', highAvail: false, excluded: false,
      avail: { Monday: mondayFree, Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
      lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0,
    });
    setRoster([
      teacher('t1', 'Ninth Teacher', []),
      teacher('t2', 'Tenth Teacher', []),
      teacher('t3', 'Combined Teacher', []),
      teacher('t4', 'Chaperone Free', [3]),
    ]);
    setLog([]);
    scheduleData = {
      'Absent Teacher': [{ day: 'Monday', period: 3, courseName: 'Biology', section: 'SCI 10-1', room: '' }],
      'Absent Ninth': [{ day: 'Monday', period: 3, courseName: 'English 9', section: 'ENG 9-1', room: '' }],
      'Ninth Teacher': [{ day: 'Monday', period: 3, courseName: 'Algebra', section: 'MTH 9-2', room: '' }],
      'Tenth Teacher': [{ day: 'Monday', period: 3, courseName: 'History', section: 'HIS 10-2', room: '' }],
      'Combined Teacher': [{ day: 'Monday', period: 3, courseName: 'Science', section: 'SCI 6/7-1', room: '' }],
      'Chaperone Free': [{ day: 'Monday', period: 1, courseName: 'Lit', section: 'ENG 9-3', room: '' }],
    };
  });
}

// Sets the run date and types one absence row, the way a person would.
async function enterAbsence(page, date, teacher, period, course, section) {
  await page.evaluate(({ date, teacher, period, course, section }) => {
    document.getElementById('run-date').value = date;
    onDateChange();
    const row = document.querySelector('#absences-tbody tr');
    row.querySelector('.abs-teacher').value = '__custom__';
    row.querySelector('.abs-teacher-custom').value = teacher;
    row.querySelector('.abs-period').value = String(period);
    row.querySelector('.abs-course').value = course;
    row.querySelector('.abs-section').value = section;
  }, { date, teacher, period, course, section });
}

test.describe('Grade Out / Field Trip', () => {
  test('grades come from the "SUBJ GRADE-SECTION" code, including combined 6/7, and a section number is never read as a grade', async ({ page }) => {
    await gotoApp(page);
    const result = await page.evaluate(() => ({
      ninth: classGrades({ section: 'ENG 9-2' }),
      combined: classGrades({ section: 'SCI 6/7-1' }),
      suffixed: classGrades({ section: 'MTH 8-1.G1.SCH' }),
      section12: classGrades({ section: 'ENG 11-12' }),
      none: classGrades({ section: 'Advisory', courseName: 'Advisory' }),
      combinedSixOnly: classAllInGrades({ section: 'SCI 6/7-1' }, ['6']),
      combinedBoth: classAllInGrades({ section: 'SCI 6/7-1' }, ['6', '7']),
    }));
    expect(result.ninth).toEqual(['9']);
    expect(result.combined).toEqual(['6', '7']);
    expect(result.suffixed).toEqual(['8']);
    expect(result.section12).toEqual(['11']);
    expect(result.none).toEqual([]);
    expect(result.combinedSixOnly).toBe(false);
    expect(result.combinedBoth).toBe(true);
  });

  test('with grade 9 out, a 9th grade teacher can cover during their 9th grade period, and nobody else is freed', async ({ page }) => {
    await gotoApp(page);
    await seedGradeOutDay(page);
    const result = await page.evaluate((d) => {
      setTripDay(d, { gradesOut: ['9'], chaperones: ['Chaperone Free'] });
      const { newEntries } = assignCoverage([
        { absentTeacher: 'Absent Teacher', period: 3, courseName: 'Biology', sectionNumber: 'SCI 10-1', roomNumber: '', absType: 'normal' },
      ], d, 0);
      return newEntries.map(e => ({ covering: e.coveringTeacher, reason: e.assignReason }));
    }, MONDAY);
    expect(result).toHaveLength(1);
    expect(result[0].covering).toBe('Ninth Teacher');
    expect(result[0].reason).toContain('Free from grade out');
  });

  test('a chaperone is never pulled, even on a regular free period', async ({ page }) => {
    await gotoApp(page);
    await seedGradeOutDay(page);
    const covering = await page.evaluate((d) => {
      setTripDay(d, { gradesOut: [], chaperones: ['Chaperone Free'] });
      const { newEntries } = assignCoverage([
        { absentTeacher: 'Absent Teacher', period: 3, courseName: 'Biology', sectionNumber: 'SCI 10-1', roomNumber: '', absType: 'normal' },
      ], d, 0);
      return newEntries[0].coveringTeacher;
    }, MONDAY);
    expect(covering).toBe('⚠ UNASSIGNED');
  });

  test('an absent teacher\'s class for the grade that is out needs no coverage', async ({ page }) => {
    await gotoApp(page);
    await seedGradeOutDay(page);
    const count = await page.evaluate((d) => {
      setTripDay(d, { gradesOut: ['9'], chaperones: [] });
      const { newEntries } = assignCoverage([
        { absentTeacher: 'Absent Ninth', period: 3, courseName: 'English 9', sectionNumber: 'ENG 9-1', roomNumber: '', absType: 'normal' },
      ], d, 0);
      return newEntries.length;
    }, MONDAY);
    expect(count).toBe(0);
  });

  test('a combined 6/7 class is not freed when only grade 6 is out', async ({ page }) => {
    await gotoApp(page);
    await seedGradeOutDay(page);
    const covering = await page.evaluate((d) => {
      setTripDay(d, { gradesOut: ['6'], chaperones: ['Chaperone Free'] });
      const { newEntries } = assignCoverage([
        { absentTeacher: 'Absent Teacher', period: 3, courseName: 'Biology', sectionNumber: 'SCI 10-1', roomNumber: '', absType: 'normal' },
      ], d, 0);
      return newEntries[0].coveringTeacher;
    }, MONDAY);
    expect(covering).toBe('⚠ UNASSIGNED');
  });

  test('a period freed by a grade out is deprioritized behind an equal teacher on a regular free period', async ({ page }) => {
    await gotoApp(page);
    await seedGradeOutDay(page);
    const covering = await page.evaluate((d) => {
      setTripDay(d, { gradesOut: ['9'], chaperones: [] });
      const { newEntries } = assignCoverage([
        { absentTeacher: 'Absent Teacher', period: 3, courseName: 'Biology', sectionNumber: 'SCI 10-1', roomNumber: '', absType: 'normal' },
      ], d, 0);
      return newEntries[0].coveringTeacher;
    }, MONDAY);
    expect(covering).toBe('Chaperone Free');
  });

  test('the panel adds a chaperone, saves it for that date, and lists their classes that still meet', async ({ page }) => {
    await gotoApp(page);
    await seedGradeOutDay(page);
    await page.evaluate((d) => {
      document.getElementById('run-date').value = d;
      onDateChange();
    }, MONDAY);

    await page.locator('#trip-btn').click();
    await page.selectOption('#trip-chaperone-select', 'Tenth Teacher');
    await page.getByRole('button', { name: 'Add as chaperone' }).click();
    await expect(page.locator('#trip-chaperone-list')).toContainText('Tenth Teacher');
    await expect(page.locator('#trip-warnings')).toContainText('Tenth Teacher still has P3 HIS 10-2 today with no absence row');

    await page.locator('.trip-grade-check[data-grade="9"]').check();
    const saved = await page.evaluate((d) => getTripDay(d), MONDAY);
    expect(saved).toEqual({ gradesOut: ['9'], chaperones: ['Tenth Teacher'] });

    // Another date starts clean
    await page.evaluate(() => {
      document.getElementById('run-date').value = '2026-06-02';
      onDateChange();
    });
    await expect(page.locator('#trip-chaperone-list')).not.toContainText('Tenth Teacher');
  });

  test('editing a teacher keeps their Grade 12 Temp Periods instead of silently wiping them', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => {
      setRoster([{ id: 't1', name: 'Senior Teacher', tier: '1', highAvail: false, excluded: false,
        avail: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
        lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0,
        tempPeriods: [{ day: 'Monday', period: 2 }] }]);
      openTeacherModal('t1');
    });
    await page.evaluate(() => saveTeacher());
    const temp = await page.evaluate(() => getRoster()[0].tempPeriods);
    expect(temp).toEqual([{ day: 'Monday', period: 2 }]);
  });

  test('a trip entered on one device reaches the other through sync', async ({ page, browser }) => {
    const store = makeGithubStore();
    page.on('dialog', d => d.accept());
    await installGithubMock(page.context(), store);
    await gotoApp(page);
    await page.evaluate((d) => setTripDay(d, { gradesOut: ['9'], chaperones: ['Jane Smith'] }), MONDAY);
    await connectDeviceToSync(page, { token: 'tok' });
    await waitForSyncIdle(page);

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    pageB.on('dialog', d => d.accept());
    await installGithubMock(contextB, store);
    await gotoApp(pageB);
    await connectDeviceToSync(pageB, { token: 'tok' });
    await waitForSyncIdle(pageB);

    expect(await pageB.evaluate((d) => getTripDay(d), MONDAY)).toEqual({ gradesOut: ['9'], chaperones: ['Jane Smith'] });
    await contextB.close();
  });
  test('a grade out set after coverage was already run flags the stale assignment, and removing it keeps the teacher out', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await gotoApp(page);
    await seedGradeOutDay(page);
    await enterAbsence(page, MONDAY, 'Absent Ninth', 3, 'English 9', 'ENG 9-1');
    await page.evaluate(() => runCoverage());
    expect(await page.evaluate(() => getLog().map(e => e.coveringTeacher))).toEqual(['Chaperone Free']);

    await page.locator('#trip-btn').click();
    await page.locator('.trip-grade-check[data-grade="9"]').check();
    await expect(page.locator('#trip-warnings')).toContainText('Absent Ninth P3 ENG 9-1 is covered by Chaperone Free, but that grade is out');

    await page.getByRole('button', { name: 'Remove those assignments' }).click();
    const after = await page.evaluate((d) => ({
      log: getLog(),
      absences: getAbsencesByDate(d),
      total: getRoster().find(t => t.name === 'Chaperone Free').totalCoverages,
    }), MONDAY);
    expect(after.log).toEqual([]);
    expect(after.total).toBe(0);
    expect(after.absences).toEqual([expect.objectContaining({ teacher: 'Absent Ninth', period: 3, absType: 'skip' })]);
    await expect(page.locator('#trip-warnings')).toHaveCount(0);
  });

  test('a chaperone added after coverage was run is flagged, and the next run replaces them', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await gotoApp(page);
    await seedGradeOutDay(page);
    await enterAbsence(page, MONDAY, 'Absent Teacher', 3, 'Biology', 'SCI 10-1');
    await page.evaluate(() => runCoverage());
    expect(await page.evaluate(() => getLog()[0].coveringTeacher)).toBe('Chaperone Free');

    await page.locator('#trip-btn').click();
    await page.selectOption('#trip-chaperone-select', 'Chaperone Free');
    await page.getByRole('button', { name: 'Add as chaperone' }).click();
    await expect(page.locator('#trip-warnings')).toContainText('Chaperone Free is a chaperone but is assigned to cover Absent Teacher P3');

    await page.evaluate(() => runCoverage());
    expect(await page.evaluate(() => getLog()[0].coveringTeacher)).not.toBe('Chaperone Free');
    await page.evaluate(() => renderTripPanel());
    await expect(page.locator('#trip-warnings')).not.toContainText('is a chaperone but is assigned');
  });

  test('the "no absence row" reminder for a chaperone clears once a row is added for that class', async ({ page }) => {
    await gotoApp(page);
    await seedGradeOutDay(page);
    await page.evaluate((d) => setTripDay(d, { gradesOut: [], chaperones: ['Tenth Teacher'] }), MONDAY);
    await enterAbsence(page, MONDAY, 'Tenth Teacher', 3, 'History', 'HIS 10-2');
    await expect(page.locator('#trip-warnings')).toContainText('Tenth Teacher still has P3 HIS 10-2 today with no absence row');
    await page.locator('#absences-tbody .abs-course').first().dispatchEvent('change');
    await expect(page.locator('#trip-area')).not.toContainText('with no absence row');
  });
  test('the Field Trip button stays plain on a normal day, and says what is set (and when something needs a look) once a trip is entered', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await gotoApp(page);
    await seedGradeOutDay(page);
    await enterAbsence(page, MONDAY, 'Absent Ninth', 3, 'English 9', 'ENG 9-1');
    await expect(page.locator('#trip-btn')).toHaveText('Field Trip');
    await expect(page.locator('#trip-modal')).not.toHaveClass(/open/);

    await page.evaluate(() => runCoverage());
    await page.locator('#trip-btn').click();
    await page.locator('.trip-grade-check[data-grade="9"]').check();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('#trip-modal')).not.toHaveClass(/open/);
    await expect(page.locator('#trip-btn')).toHaveText('Field Trip: Grade 9 out · 1 warning');

    // Another date with nothing set goes back to plain
    await page.evaluate(() => { document.getElementById('run-date').value = '2026-06-02'; onDateChange(); });
    await expect(page.locator('#trip-btn')).toHaveText('Field Trip');
  });
});
