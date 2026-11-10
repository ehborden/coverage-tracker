const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

// A page the browser restores (Back, a reopened tab) can put the date
// picker's old value back after the app has loaded the absences table for
// its own default date, without firing a change event. The table and the
// picker then disagree. These tests recreate that by setting the picker's
// value directly, the same way a restore does.

const MON = '2026-11-09';
const WED = '2026-11-11';

async function seed(page) {
  await page.evaluate(({ MON, WED }) => {
    const t = (id, name, avail) => ({ id, name, tier: '1', highAvail: false, excluded: false, avail,
      lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 });
    const none = { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] };
    setRoster([
      t('t1', 'Testa, Morgan', none),
      t('t2', 'Other, Ann', none),
      t('t3', 'Free, Sam', { Monday: [5], Tuesday: [], Wednesday: [2], Thursday: [], Friday: [] }),
    ]);
    setLog([]);
    scheduleData = {
      'Testa, Morgan': [
        { day: 'Monday', period: 1, courseName: 'Algebra II 11-4', section: 'MATH 11-4', room: '403' },
        { day: 'Monday', period: 6, courseName: 'Intro to Psychology', section: 'SCI 11-3', room: '518' },
        { day: 'Wednesday', period: 3, courseName: 'Calculus H', section: 'MATH 12-H', room: '403' },
        { day: 'Wednesday', period: 4, courseName: 'Intro to Psychology', section: 'SCI 11-3', room: '518' },
      ],
    };
    // Go to Monday first, so the table the app opened on (whatever day
    // it is when the test runs) is saved before the test data goes in
    document.getElementById('run-date').value = MON;
    onDateChange();
    // Wednesday already has its own real absence; Monday has Ann
    setData('cs_absences_' + WED, [{ teacher: 'Other, Ann', period: 2, course: 'Wed Class', section: 'W-1', room: '1', noCoverage: false, absType: 'normal' }]);
    setData('cs_absences_' + MON, [{ teacher: 'Other, Ann', period: 5, course: 'Mon Class', section: 'M-1', room: '1', noCoverage: false, absType: 'normal' }]);
    renderAbsencesTable();
    // The browser puts an old value back: no change event fires
    document.getElementById('run-date').value = WED;
  }, { MON, WED });
}

test('the date fields ask the browser not to restore old values', async ({ page }) => {
  await gotoApp(page);
  const offs = await page.$$eval('input[type="date"]', els => els.map(e => e.getAttribute('autocomplete')));
  expect(offs.length).toBeGreaterThan(0);
  expect(offs.every(v => v === 'off')).toBe(true);
});

test('Add by Teacher fills rows for the date the table shows after a picker mismatch', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  await page.evaluate(() => openAddByTeacher());
  await page.selectOption('#abt-teacher', 'Testa, Morgan');
  await page.evaluate(() => confirmAddByTeacher());
  const stored = await page.evaluate(({ MON, WED }) => {
    saveAbsencesForDate(currentAbsenceDate);
    return { current: currentAbsenceDate, mon: getAbsencesByDate(MON), wed: getAbsencesByDate(WED) };
  }, { MON, WED });
  // The table was lined up with the picker (Wednesday) before rows were
  // filled, so Testa gets Wednesday's classes under Wednesday...
  expect(stored.current).toBe(WED);
  const wedTesta = stored.wed.filter(a => a.teacher === 'Testa, Morgan').map(a => a.period).sort();
  expect(wedTesta).toEqual([3, 4]);
  expect(stored.wed.some(a => a.teacher === 'Other, Ann' && a.period === 2)).toBe(true);
  // ...and Monday is untouched: no Wednesday periods leak into it
  expect(stored.mon).toEqual([{ teacher: 'Other, Ann', period: 5, course: 'Mon Class', section: 'M-1', room: '1', noCoverage: false, absType: 'normal' }]);
});

test('a save during a picker mismatch never writes one day\'s rows over another day', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  // Autosave and closing the tab both save the table: under its own date
  await page.evaluate(() => {
    const ev = new Event('beforeunload');
    window.dispatchEvent(ev);
  });
  const wed = await page.evaluate((WED) => getAbsencesByDate(WED), WED);
  expect(wed).toEqual([{ teacher: 'Other, Ann', period: 2, course: 'Wed Class', section: 'W-1', room: '1', noCoverage: false, absType: 'normal' }]);
});

test('Assign Coverage after a picker mismatch stops, shows the picker\'s date, and runs it on the next click', async ({ page }) => {
  await gotoApp(page);
  await seed(page);
  const alerts = [];
  page.on('dialog', d => { alerts.push(d.message()); d.accept(); });
  await page.evaluate(() => runCoverage());
  expect(alerts).toHaveLength(1);
  expect(alerts[0]).toContain('different date');
  expect(await page.evaluate(() => getLog())).toEqual([]);
  expect(await page.evaluate(() => currentAbsenceDate)).toBe('2026-11-11');
  await page.evaluate(() => runCoverage());
  const res = await page.evaluate(({ MON, WED }) => ({
    mon: getAbsencesByDate(MON), wedLog: getLog().filter(e => e.date === WED), monLog: getLog().filter(e => e.date === MON),
  }), { MON, WED });
  expect(res.mon.map(a => a.period)).toEqual([5]);
  expect(res.wedLog.map(e => e.absentTeacher + ' ' + e.period)).toEqual(['Other, Ann 2']);
  expect(res.monLog).toEqual([]);
});
