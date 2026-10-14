const { test, expect } = require('@playwright/test');
const { gotoApp, APP_PATH } = require('./helpers');

test.describe('Misc regression fixes', () => {
  test('Schedule Inspector "Add Class" period dropdown has real options', async ({ page }) => {
    await gotoApp(page);
    const options = await page.$$eval('#si-add-period option', els => els.map(e => e.value));
    expect(options).toEqual(['1', '2', '3', '4', '5', '6', '7']);
  });

  test('typing into an absence row saves it to storage immediately, not only at a date switch, Assign Coverage, or closing the tab', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => {
      document.getElementById('run-date').value = '2026-06-01';
      renderAbsencesTable();
    });

    // Real UI interactions (not page.evaluate setting .value directly) so
    // this exercises the actual input/change listeners, the same way a
    // person typing would — no date switch, no Assign Coverage, no reload.
    await page.selectOption('#absences-tbody .abs-teacher', '__custom__');
    await page.fill('#absences-tbody .abs-teacher-custom', 'Jane Smith');
    await page.fill('#absences-tbody .abs-course', 'Math');

    // Give the debounce (400ms) a moment, nothing else.
    await page.waitForTimeout(600);

    const saved = await page.evaluate(() => getAbsencesByDate('2026-06-01'));
    expect(saved).toHaveLength(1);
    expect(saved[0].teacher).toBe('Jane Smith');
    expect(saved[0].course).toBe('Math');
  });

  test('a sync-driven refresh replaces a blank placeholder row with real data even if that row merely has focus, not actually been typed into', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => {
      document.getElementById('run-date').value = '2026-06-01';
      renderAbsencesTable(); // nothing stored yet — shows one blank placeholder row
    });

    // Focus the placeholder's teacher dropdown — focused, but nothing
    // selected or typed. This used to be enough to block a sync refresh.
    await page.focus('#absences-tbody .abs-teacher');

    // Simulate a sync pull landing with real data for this date.
    await page.evaluate(() => {
      setData('cs_absences_2026-06-01', [{ teacher: 'Jane Smith', period: 1, course: 'Math' }]);
      refreshAbsencesTableIfShowing();
    });

    const text = await page.locator('#absences-tbody').textContent();
    expect(text).toContain('Jane Smith');
  });

  test('a sync-driven refresh does not clobber a row genuinely being typed into', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => {
      document.getElementById('run-date').value = '2026-06-01';
      renderAbsencesTable();
    });

    await page.selectOption('#absences-tbody .abs-teacher', '__custom__');
    await page.fill('#absences-tbody .abs-teacher-custom', 'Bob Jones');

    // A sync refresh arrives mid-edit, before the 400ms autosave debounce
    // has saved this row — it must not blow away what's on screen.
    await page.evaluate(() => {
      setData('cs_absences_2026-06-01', [{ teacher: 'Someone Else', period: 2, course: 'Science' }]);
      refreshAbsencesTableIfShowing();
    });

    const customValue = await page.inputValue('#absences-tbody .abs-teacher-custom');
    expect(customValue).toBe('Bob Jones');
  });

  test('getWeekBounds returns the correct Mon-Fri window regardless of timezone', async ({ page }) => {
    await gotoApp(page);
    const bounds = await page.evaluate(() => getWeekBounds('2026-06-03')); // a Wednesday
    expect(bounds).toEqual({ start: '2026-06-01', end: '2026-06-05' });
  });

  test('parseCSVLine handles an escaped "" quote inside a quoted field', async ({ page }) => {
    await gotoApp(page);
    const parsed = await page.evaluate(() => parseCSVLine('a,"say ""hi"" now",c'));
    expect(parsed).toEqual(['a', 'say "hi" now', 'c']);
  });

  test('loadScheduleCSV warns on an unparseable meeting-time and does not mark that teacher "free"', async ({ page }) => {
    await gotoApp(page);
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });

    const csv = 'Teacher,Class ID,Description,Meeting Times,Status\n'
      + 'Bob Jones,M-1,Math,M 3,Active\n' // space instead of hyphen -> fails to parse
      + 'Jane Smith,S-1,Science,M-1,Active\n';

    await page.evaluate((csvText) => {
      const file = new File([csvText], 'schedule.csv', { type: 'text/csv' });
      loadScheduleCSV({ target: { files: [file], value: '' } });
    }, csv);
    await page.waitForTimeout(200);

    const result = await page.evaluate(() => ({
      bobInSchedule: Object.prototype.hasOwnProperty.call(scheduleData, 'Bob Jones'),
      janeInSchedule: Object.prototype.hasOwnProperty.call(scheduleData, 'Jane Smith'),
      scheduledClassForBob: scheduledClassFor('Bob Jones', 'Monday', 3),
    }));

    expect(result.bobInSchedule).toBe(false); // not present-but-empty, genuinely missing
    expect(result.janeInSchedule).toBe(true);
    expect(result.scheduledClassForBob).toBeNull(); // "no data", not "confirmed free"
    expect(dialogs.some(m => m.includes("couldn't be read"))).toBe(true);
  });

  test('a confirmed free period (schedule has the teacher, but nothing that slot) is dropped, not flagged', async ({ page }) => {
    await gotoApp(page);
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });

    const result = await page.evaluate(() => {
      scheduleData = { 'Bob Jones': [{ day: 'Monday', period: 1, courseName: 'Math', section: '', room: '' }] };
      return scheduledClassFor('Bob Jones', 'Wednesday', 1); // teacher known, nothing that day/period
    });

    expect(result).toBe('free');
  });

  test('Room Chart matching ignores case, since the Schedule and Room Chart exports don\'t agree on it', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    // Real-world shape: the Room Chart export writes this class in Title
    // Case ("Eng 11-4"), the Schedule export writes the same class in
    // all-caps ("ENG 11-4"). They have to be treated as the same class.
    const csv = 'CAP,,M1\n20,420,Eng 11-4\n';
    await page.evaluate((csvText) => {
      const file = new File([csvText], 'roomchart.csv', { type: 'text/csv' });
      loadRoomChartCSV({ target: { files: [file], value: '' } });
    }, csv);
    await page.waitForTimeout(200);

    const room = await page.evaluate(() => getRoomFromChart('ENG 11-4', 'Monday', 1));
    expect(room).toBe('420');

    // A schedule loaded afterward should pick the room up automatically too.
    const scheduleCsv = 'Teacher,Class ID,Description,Meeting Times,Status\n'
      + 'Jane Smith,ENG 11-4,English 11,M-1,Active\n';
    await page.evaluate((csvText) => {
      const file = new File([csvText], 'schedule.csv', { type: 'text/csv' });
      loadScheduleCSV({ target: { files: [file], value: '' } });
    }, scheduleCsv);
    await page.waitForTimeout(200);

    const scheduledRoom = await page.evaluate(() => scheduledClassFor('Jane Smith', 'Monday', 1).room);
    expect(scheduledRoom).toBe('420');
  });

  test('Room Chart matching falls back to a stripped class id when the Schedule side has an extra session/group suffix', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    // Real-world shape: the Schedule export tags the pull-out section
    // "MTH 8-1.G1.SCH", but the Room Chart export drops the ".SCH" and
    // just writes "Mth 8-1.g1" for the same class.
    const csv = 'CAP,,M3\n14,403,Mth 8-1.g1\n';
    await page.evaluate((csvText) => {
      const file = new File([csvText], 'roomchart.csv', { type: 'text/csv' });
      loadRoomChartCSV({ target: { files: [file], value: '' } });
    }, csv);
    await page.waitForTimeout(200);

    const room = await page.evaluate(() => getRoomFromChart('MTH 8-1.G1.SCH', 'Monday', 3));
    expect(room).toBe('403');
  });

  test('uploading a new Schedule CSV automatically offers to sync roster availability, instead of needing a separate click', async ({ page }) => {
    await gotoApp(page);
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });

    await page.evaluate(() => { setRoster([]); });

    // A "Coverage" row is what makes deriveAvailabilityFromSchedule actually
    // have something to offer (see isCoverageSlot) — without one it exits
    // early with no dialog at all, which is covered by the other tests
    // above that upload schedules with no Coverage row and see nothing hang.
    const csv = 'Teacher,Class ID,Description,Meeting Times,Status\n'
      + 'Jane Smith,M-1,Algebra,M-1,Active\n'
      + 'Jane Smith,CVRG-1,Coverage,T-2,Active\n';

    await page.evaluate((csvText) => {
      const file = new File([csvText], 'schedule.csv', { type: 'text/csv' });
      loadScheduleCSV({ target: { files: [file], value: '' } });
    }, csv);
    await page.waitForTimeout(200);

    expect(dialogs.some(m => m.includes('Sync roster with schedule'))).toBe(true);
    const jane = await page.evaluate(() => getRoster().find(t => t.name === 'Jane Smith'));
    expect(jane).toBeTruthy();
    expect(jane.avail.Tuesday).toEqual([2]);
  });

  test('Math.random is never used in any assignment or fairness logic', async ({ page }) => {
    // Picks are driven entirely by the weighted sort in assignCoverage; the
    // only legitimate use of Math.random in the whole app is generating a
    // unique id when a new teacher is added during Sync with Schedule.
    const fs = require('fs');
    const html = fs.readFileSync(APP_PATH, 'utf8');
    const matches = [...html.matchAll(/Math\.random/g)];
    expect(matches).toHaveLength(1);
  });

  test('course/room/teacher text is escaped on the output document, not inserted as raw HTML', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());

    await page.evaluate(() => {
      setRoster([{ id: 't1', name: 'Jane <b>Smith</b>', tier: '1', highAvail: false, excluded: false,
        avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
        lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 }]);
      setLog([]);
      document.getElementById('run-date').value = '2026-06-01';
      renderAbsencesTable();
      const row = document.querySelector('#absences-tbody tr');
      row.querySelector('.abs-teacher').value = '__custom__';
      row.querySelector('.abs-teacher-custom').value = '<img src=x onerror=alert(1)>';
      row.querySelector('.abs-period').value = '1';
      row.querySelector('.abs-course').value = '<script>bad</script> Math';
      row.querySelector('.abs-section').value = '<b>M-1</b>';
      row.querySelector('.abs-room').value = '<i>101</i>';
      runCoverage();
    });

    // No actual <img>/<script>/<b>/<i> element should exist in the output —
    // everything from absence data must have come through as inert text.
    const hasRawTags = await page.evaluate(() =>
      !!document.querySelector('#output-doc img, #output-doc script, #output-doc b, #output-doc i'));
    expect(hasRawTags).toBe(false);

    // The text content should still show it, just as literal characters.
    const text = await page.evaluate(() => document.getElementById('output-doc').textContent);
    expect(text).toContain('<script>bad</script> Math');
    expect(text).toContain('Jane <b>Smith</b>');
  });
  test('Coverage duty periods start unchecked in Add by Teacher and are left off later days of a multi-day run', async ({ page }) => {
    await gotoApp(page);
    await page.evaluate(() => {
      scheduleData = {
        'Duty Teacher': [
          { day: 'Monday', period: 1, courseName: 'Algebra', section: 'MTH 9-1', room: '' },
          { day: 'Monday', period: 2, courseName: 'Coverage', section: '', room: '' },
          { day: 'Monday', period: 3, courseName: 'Duty', section: 'CVRG-3', room: '' },
          { day: 'Tuesday', period: 4, courseName: 'Coverage', section: '', room: '' },
        ],
      };
      document.getElementById('run-date').value = '2026-06-01'; // a Monday
      openAddByTeacher();
      document.getElementById('abt-teacher').value = 'Duty Teacher';
      loadTeacherPeriods();
    });
    const boxes = await page.evaluate(() =>
      [...document.querySelectorAll('.abt-period-check')].map(cb => ({ period: cb.dataset.period, checked: cb.checked })));
    expect(boxes).toEqual([
      { period: '1', checked: true },
      { period: '2', checked: false },
      { period: '3', checked: false },
    ]);
    await expect(page.locator('#abt-periods')).toContainText('Coverage period — skipped');

    const ranged = await page.evaluate(() => ({
      monday: rowsForRangeDay([{ absentTeacher: 'Duty Teacher', period: 1, absType: 'normal' }], 'Monday').rows,
      tuesday: rowsForRangeDay([{ absentTeacher: 'Duty Teacher', period: 1, absType: 'normal' }], 'Tuesday').rows,
    }));
    expect(ranged.monday.map(r => r.period)).toEqual([1]);
    // Only a Coverage period that day: still out (so not pulled), nothing to cover
    expect(ranged.tuesday).toEqual([expect.objectContaining({ absentTeacher: 'Duty Teacher', absType: 'skip' })]);
  });
  test('with "Senior classes ended" on, later days of a multi-day run leave 12th grade classes off too', async ({ page }) => {
    await gotoApp(page);
    const result = await page.evaluate(() => {
      scheduleData = {
        'Senior Teacher': [
          { day: 'Tuesday', period: 1, courseName: 'English 12', section: 'ENG 12-1', room: '' },
          { day: 'Tuesday', period: 2, courseName: 'English 11', section: 'ENG 11-2', room: '' },
          { day: 'Wednesday', period: 1, courseName: 'English 12', section: 'ENG 12-1', room: '' },
        ],
      };
      const base = [{ absentTeacher: 'Senior Teacher', period: 1, absType: 'normal' }];
      localStorage.setItem('cs_senior_ended', '0');
      const before = rowsForRangeDay(base, 'Tuesday').rows.map(r => r.period);
      localStorage.setItem('cs_senior_ended', '1');
      return {
        before,
        tuesday: rowsForRangeDay(base, 'Tuesday').rows.map(r => r.period),
        wednesday: rowsForRangeDay(base, 'Wednesday').rows,
      };
    });
    expect(result.before).toEqual([1, 2]);
    expect(result.tuesday).toEqual([2]);
    // Only a senior class that day: still out (so not pulled), nothing to cover
    expect(result.wednesday).toEqual([expect.objectContaining({ absentTeacher: 'Senior Teacher', absType: 'skip' })]);
  });
  test('a failed save shows a warning banner and one alert, instead of failing silently', async ({ page }) => {
    await gotoApp(page);
    const alerts = [];
    page.on('dialog', d => { alerts.push(d.message()); d.accept(); });
    await page.evaluate(() => {
      Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };
      setData('cs_roster', []);
      setData('cs_log', []); // a second failure: banner stays, no second alert
    });
    await expect(page.locator('#save-failure-banner')).toContainText('Changes are NOT being saved (browser storage is full)');
    expect(alerts).toHaveLength(1);

    // A direct localStorage.setItem call (not through setData) that throws
    // out of an event handler reaches the same warning.
    await page.evaluate(() => { document.getElementById('save-failure-banner').remove(); });
    await page.evaluate(() => setTimeout(() => saveSeniorClassesFlag(), 0));
    await expect(page.locator('#save-failure-banner')).toBeVisible();
    expect(alerts).toHaveLength(1);
  });
  test('Roster rows show tier as text and free periods as boxes; delete moved into the Edit window', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());
    await page.evaluate(() => {
      setRoster([{ id: 't1', name: 'Jane Smith', tier: '2', highAvail: true, excluded: false,
        avail: { Monday: [1, 4], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
        lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 }]);
      showScreen('roster');
    });
    const row = page.locator('#roster-tbody tr').first();
    await expect(row.locator('select')).toHaveCount(0);
    await expect(row.locator('.tier-chip')).toHaveText('2');
    await expect(row.getByRole('img', { name: 'Monday: Free periods 1, 4' })).toBeVisible();
    await expect(row.locator('.pbox.on')).toHaveCount(2);
    await expect(row).toContainText('Hi-Avail');
    await expect(row.getByRole('button')).toHaveText(['Edit']);

    await row.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete Teacher' }).click();
    await expect(page.locator('#teacher-modal')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => getRoster().length)).toBe(0);

    await page.evaluate(() => openTeacherModal());
    await expect(page.getByRole('button', { name: 'Delete Teacher' })).toBeHidden();
  });
  test('coverage results: one compact row per period, notes hidden until "+ note", and Copy Assignment text unchanged', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());
    await page.evaluate(() => {
      const t = (id, name) => ({ id, name, tier: '1', highAvail: false, excluded: false,
        avail: { Monday: [1, 2], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
        lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 });
      setRoster([t('t1', 'Jane Smith'), t('t2', 'Amy Lee')]);
      setLog([]);
      localStorage.setItem('cs_notes_2026-06-01', JSON.stringify({ period_Bob_Jones_2: 'Plans on desk' }));
      document.getElementById('run-date').value = '2026-06-01';
      renderAbsencesTable();
      const fill = (row, p, course) => {
        row.querySelector('.abs-teacher').value = '__custom__';
        row.querySelector('.abs-teacher-custom').value = 'Bob Jones';
        row.querySelector('.abs-period').value = String(p);
        row.querySelector('.abs-course').value = course;
        row.querySelector('.abs-section').value = 'MTH 9-' + p;
        row.querySelector('.abs-room').value = '10' + p;
      };
      fill(document.querySelector('#absences-tbody tr'), 1, 'Algebra');
      addAbsenceRow();
      fill(document.querySelectorAll('#absences-tbody tr')[1], 2, 'Geometry');
      runCoverage();
    });

    const rows = page.locator('#output-doc .out-table tbody tr:not(.out-note-row)');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('Algebra · MTH 9-1');
    await expect(page.locator('#output-doc .out-teacher h3')).toHaveText(['Bob Jones']);

    // Empty notes are hidden behind buttons; a saved note shows
    await expect(page.locator('#output-doc .out-note:visible')).toHaveCount(1);
    await expect(page.locator('#output-doc .out-note:visible')).toHaveValue('Plans on desk');
    await page.getByRole('button', { name: '+ note for Bob Jones' }).click();
    await page.getByLabel('Overall notes for Bob Jones').fill('Out all day');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cs_notes_2026-06-01')).teacher_Bob_Jones)).toBe('Out all day');

    const copied = await page.evaluate(async () => {
      let text = null;
      navigator.clipboard.write = async (items) => { text = await (await items[0].getType('text/plain')).text(); };
      copyFullAssignment();
      await new Promise(r => setTimeout(r, 50));
      return text;
    });
    const covering = await page.evaluate(() => getLog().sort((a, b) => a.period - b.period).map(e => e.coveringTeacher));
    expect(copied).toContain('For: Bob Jones\nOut all day\n\n');
    expect(copied).toContain(`Period 1: Algebra, MTH 9-1, Room 101 - ${covering[0]}`);
    expect(copied).toContain(`Period 2: Geometry, MTH 9-2, Room 102 - ${covering[1]}\n  Plans on desk`);
  });
});
