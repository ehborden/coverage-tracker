const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

// Assign Coverage warns when an absence row's class isn't what the teacher
// actually has that day and period, whatever put the row there.

const MON = '2026-11-09';

async function seed(page, rows) {
  await page.evaluate(({ MON, rows }) => {
    const t = (id, name, avail) => ({ id, name, tier: '1', highAvail: false, excluded: false, avail,
      lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 });
    const free = { Monday: [1, 2, 3, 4, 5, 6, 7], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] };
    const none = { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] };
    setRoster([t('t1', 'Testa, Robin', none), t('t2', 'Free, Pat', free), t('t3', 'Typed, Tom', none)]);
    setLog([]);
    scheduleData = {
      'Testa, Robin': [
        { day: 'Monday', period: 1, courseName: 'Algebra II 11-4', section: 'MATH 11-4', room: '403' },
        { day: 'Monday', period: 6, courseName: 'Intro to Psychology', section: 'SCI 11-3', room: '518' },
        { day: 'Wednesday', period: 3, courseName: 'Calculus H', section: 'MATH 12-H', room: '403' },
        { day: 'Wednesday', period: 4, courseName: 'Intro to Psychology', section: 'SCI 11-3', room: '518' },
      ],
    };
    setData('cs_absences_' + MON, rows);
    document.getElementById('run-date').value = MON;
    renderAbsencesTable();
  }, { MON, rows });
}

const row = (teacher, period, course, section, absType = 'normal') =>
  ({ teacher, period, course, section, room: '', noCoverage: absType === 'skip', absType });

test('a row with another day\'s class warns and, on Cancel, assigns nothing', async ({ page }) => {
  await gotoApp(page);
  await seed(page, [row('Testa, Robin', 3, 'Calculus H', 'MATH 12-H'), row('Testa, Robin', 6, 'Intro to Psychology', 'SCI 11-3')]);
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  await page.evaluate(() => runCoverage());
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]).toContain("This row doesn't match the schedule for Monday, 11/9");
  expect(dialogs[0]).toContain('Testa, Robin, period 3: the row says Calculus H (MATH 12-H); the schedule has no class then');
  expect(dialogs[0]).not.toContain('period 6');
  expect(await page.evaluate(() => getLog())).toEqual([]);
});

test('a row with a different class that period names what the schedule has', async ({ page }) => {
  await gotoApp(page);
  await seed(page, [row('Testa, Robin', 1, 'Intro to Psychology', 'SCI 11-3')]);
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
  await page.evaluate(() => runCoverage());
  expect(dialogs[0]).toContain('the schedule has Algebra II 11-4 (MATH 11-4)');
});

test('OK on the warning assigns coverage anyway', async ({ page }) => {
  await gotoApp(page);
  await seed(page, [row('Testa, Robin', 3, 'Calculus H', 'MATH 12-H')]);
  page.on('dialog', d => d.accept());
  await page.evaluate(() => runCoverage());
  const log = await page.evaluate(() => getLog());
  expect(log.map(e => `${e.absentTeacher} ${e.period} ${e.coveringTeacher}`)).toEqual(['Testa, Robin 3 Free, Pat']);
});

test('no warning for matching rows, Skip rows, or teachers not in the schedule', async ({ page }) => {
  await gotoApp(page);
  await seed(page, [
    row('Testa, Robin', 1, 'algebra ii 11-4', 'math 11-4'), // case differences still match
    row('Testa, Robin', 4, '', '', 'skip'),
    row('Typed, Tom', 2, 'Some Class', 'X-1'),
  ]);
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await page.evaluate(() => runCoverage());
  expect(dialogs.filter(m => m.includes("match the schedule"))).toEqual([]);
  expect((await page.evaluate(() => getLog())).length).toBeGreaterThan(0);
});
