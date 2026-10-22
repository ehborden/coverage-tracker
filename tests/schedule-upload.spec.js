const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

const HEADER = 'Teacher,Class ID,Description,Meeting Times,Status,Room,Co-Teacher\n';

async function upload(page, csv) {
  await page.evaluate((text) => {
    const file = new File([text], 'schedule.csv', { type: 'text/csv' });
    loadScheduleCSV({ target: { files: [file], value: '' } });
  }, csv);
  await page.waitForTimeout(200);
}

test.describe('Schedule uploads: co-teachers, hand-added classes, change check', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', d => d.accept());
    await gotoApp(page);
  });

  test('a Co-Teacher column gives the co-teacher every meeting, marked as co-taught', async ({ page }) => {
    await upload(page, HEADER
      + 'Jane Smith,ENG 9-1,English 9,"M-1, W-1",Active,201,Amy Lee; Bob Jones\n'
      + 'Amy Lee,SCI 9-1,Biology,T-2,Active,110,\n');
    const r = await page.evaluate(() => ({
      amy: scheduleData['Amy Lee'].filter(c => c.section === 'ENG 9-1').map(c => [c.day, c.period, c.coTeacherOf]),
      bob: scheduleData['Bob Jones'].map(c => c.coTeacherOf),
      jane: scheduleData['Jane Smith'].map(c => c.coTeacherOf || null),
    }));
    expect(r.amy).toEqual([['Monday', 1, 'Jane Smith'], ['Wednesday', 1, 'Jane Smith']]);
    expect(r.bob).toEqual(['Jane Smith', 'Jane Smith']);
    expect(r.jane).toEqual([null, null]);
  });

  test('a re-upload shows what changed; Cancel changes nothing, Apply applies and keeps a hand-added co-teacher', async ({ page }) => {
    await upload(page, HEADER
      + 'Jane Smith,ENG 9-1,English 9,M-1,Active,201,\n'
      + 'Bob Jones,MTH 10-1,Algebra,T-3,Active,305,\n'
      + 'Carl Moss,ART 8-1,Art,F-2,Active,12,\n');
    await page.evaluate(() => showScreen('run'));
    await page.getByRole('button', { name: 'Co-Teacher' }).click();
    const choices = await page.evaluate(() => [...document.querySelectorAll('#si-co-sections option')].map(o => o.value));
    expect(choices).toEqual(['Algebra · MTH 10-1 · Bob Jones', 'Art · ART 8-1 · Carl Moss', 'English 9 · ENG 9-1 · Jane Smith']);
    await page.fill('#si-co-section', 'English 9 · ENG 9-1 · Jane Smith');
    await page.selectOption('#si-co-teacher', 'Bob Jones');
    await page.locator('#coteacher-modal').getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('#coteacher-list')).toContainText('ENG 9-1');
    await expect(page.locator('#coteacher-list .co-remove')).toBeVisible();
    await page.locator('#coteacher-modal').getByRole('button', { name: 'Done' }).click();
    expect(await page.evaluate(() => scheduleData['Bob Jones'].some(c => c.section === 'ENG 9-1' && c.manual && c.coTeacherOf === 'Jane Smith'))).toBe(true);

    // New file: ENG 9-1 moves to period 2, a room changes, Art is gone, a new teacher appears
    const second = HEADER
      + 'Jane Smith,ENG 9-1,English 9,M-2,Active,201,\n'
      + 'Bob Jones,MTH 10-1,Algebra,T-3,Active,306,\n'
      + 'Dana Fox,SPN 9-1,Spanish,W-4,Active,210,\n';
    await upload(page, second);
    const modal = page.locator('#schedule-diff-modal');
    await expect(modal).toHaveClass(/open/);
    await expect(modal).toContainText('New teachers (1)');
    await expect(modal).toContainText('Dana Fox');
    await expect(modal).toContainText('Carl Moss');
    await expect(modal).toContainText('Jane Smith: ENG 9-1 (Mon P1 → Mon P2)');
    await expect(modal).toContainText('1 room change (not listed)');
    await expect(modal).toContainText('Bob Jones on ENG 9-1 (co-teacher with Jane Smith)');

    await modal.getByRole('button', { name: 'Cancel' }).click();
    expect(await page.evaluate(() => Object.keys(scheduleData).sort())).toEqual(['Bob Jones', 'Carl Moss', 'Jane Smith']);

    await upload(page, second);
    await page.locator('#schedule-diff-modal').getByRole('button', { name: 'Apply' }).click();
    const after = await page.evaluate(() => ({
      teachers: Object.keys(scheduleData).sort(),
      bobEng: scheduleData['Bob Jones'].filter(c => c.section === 'ENG 9-1').map(c => [c.day, c.period, c.manual, c.coTeacherOf]),
    }));
    expect(after.teachers).toEqual(['Bob Jones', 'Dana Fox', 'Jane Smith']);
    // The hand-added co-teacher followed the class to its new period
    expect(after.bobEng).toEqual([['Monday', 2, true, 'Jane Smith']]);
  });

  test('a co-teacher out while the main teacher is in: still assigned, flagged to check first', async ({ page }) => {
    await upload(page, HEADER + 'Jane Smith,ENG 9-1,English 9,W-1,Active,201,Amy Lee\n');
    await page.evaluate(() => {
      setRoster([{ id: 't1', name: 'Free Teacher', tier: '1', highAvail: false, excluded: false,
        avail: { Monday: [], Tuesday: [], Wednesday: [1], Thursday: [], Friday: [] },
        lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 }]);
      setLog([]);
      document.getElementById('run-date').value = '2026-10-14'; // a Wednesday
      onDateChange();
      openAddByTeacher();
      document.getElementById('abt-teacher').value = 'Amy Lee';
      loadTeacherPeriods();
    });
    await expect(page.locator('#abt-periods')).toContainText('Co-taught with Jane Smith: check with them before assigning');
    expect(await page.locator('.abt-period-check').first().isChecked()).toBe(true);

    await page.evaluate(() => { confirmAddByTeacher(); runCoverage(); });
    await expect(page.locator('#output-doc')).toContainText('Free Teacher');
    await expect(page.locator('#output-doc')).toContainText('Co-taught with Jane Smith. Check with them first');
  });
  test('the Veracross "Teachers" column (last names, slash-separated) is read as co-teachers', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', d => dialogs.push(d.message()));
    await upload(page, 'Teacher,Class ID,Description,Meeting Times,Status,Room,Teachers\n'
      + '"Rosado-Gonzalez, Jonathan",STEAM 6,STEAM 6,M-1,Active,14,Rosado-Gonzalez/Kartzman\n'
      + '"Kartzman, Lauren",STEAM 7-1,STEAM 7-1,T-2,Active,14,"Kartzman, Lauren"\n'
      + '"Kartzman, Lauren",STEAM 8-1,STEAM 8-1,W-3,Active,14,Rosado-Gonzalez/Kartzman\n'
      + '"Kartzman, Lauren",STEAM 8-2,STEAM 8-2,R-4,Active,14,Kartzman/Nobodyhere\n'
      + '"Lee, Amy",HIS 10-1,History,F-5,Active,20,Lee/Kartzman/Rosado-Gonzalez\n');
    const r = await page.evaluate(() => ({
      kartzman: scheduleData['Kartzman, Lauren'].filter(c => c.coTeacherOf).map(c => [c.section, c.coTeacherOf]),
      rosado: scheduleData['Rosado-Gonzalez, Jonathan'].filter(c => c.coTeacherOf).map(c => [c.section, c.coTeacherOf]),
      teachers: Object.keys(scheduleData).sort(),
    }));
    expect(r.kartzman).toEqual([['STEAM 6', 'Rosado-Gonzalez, Jonathan'], ['HIS 10-1', 'Lee, Amy']]);
    expect(r.rosado).toEqual([['STEAM 8-1', 'Kartzman, Lauren'], ['HIS 10-1', 'Lee, Amy']]);
    expect(r.teachers).toEqual(['Kartzman, Lauren', 'Lee, Amy', 'Rosado-Gonzalez, Jonathan']);
    expect(dialogs.join('\n')).toContain('Nobodyhere (STEAM 8-2)');
  });
  test('removing a co-teacher takes two clicks on ✕, and one from the file stays off future uploads', async ({ page }) => {
    const csv = 'Teacher,Class ID,Description,Meeting Times,Status,Room,Teachers\n'
      + '"Kartzman, Lauren",STEAM 8-1,STEAM 8-1,W-3,Active,14,Rosado-Gonzalez/Kartzman\n'
      + '"Rosado-Gonzalez, Jonathan",STEAM 6,STEAM 6,M-1,Active,14,"Rosado-Gonzalez, Jonathan"\n';
    await upload(page, csv);
    await page.evaluate(() => showScreen('run'));
    await page.getByRole('button', { name: 'Co-Teacher' }).click();
    const x = page.locator('#coteacher-list .co-remove');
    await expect(x).toHaveText('✕');
    await x.click();
    await expect(x).toHaveText('Remove?');
    expect(await page.evaluate(() => scheduleData['Rosado-Gonzalez, Jonathan'].some(c => c.coTeacherOf))).toBe(true);
    await x.click();
    await expect(page.locator('#coteacher-list')).toContainText('No co-teachers yet.');
    expect(await page.evaluate(() => scheduleData['Rosado-Gonzalez, Jonathan'].some(c => c.coTeacherOf))).toBe(false);

    await upload(page, csv);
    await page.locator('#schedule-diff-modal').getByRole('button', { name: 'Apply' }).click();
    expect(await page.evaluate(() => scheduleData['Rosado-Gonzalez, Jonathan'].some(c => c.coTeacherOf))).toBe(false);
  });
  test('several co-teachers can be removed at once: check them, then Remove selected twice', async ({ page }) => {
    await upload(page, 'Teacher,Class ID,Description,Meeting Times,Status,Room,Teachers\n'
      + '"Kartzman, Lauren",STEAM 8-1,STEAM 8-1,W-3,Active,14,Rosado-Gonzalez/Kartzman/Lee\n'
      + '"Rosado-Gonzalez, Jonathan",STEAM 6,STEAM 6,M-1,Active,14,Rosado-Gonzalez/Kartzman\n'
      + '"Lee, Amy",HIS 10-1,History,F-5,Active,20,"Lee, Amy"\n');
    await page.evaluate(() => showScreen('run'));
    await page.getByRole('button', { name: 'Co-Teacher' }).click();
    await expect(page.locator('.co-pick')).toHaveCount(3);
    const btn = page.locator('#co-remove-selected');
    await expect(btn).toBeDisabled();
    await page.locator('.co-pick').nth(0).check();
    await page.locator('.co-pick').nth(1).check();
    await expect(btn).toHaveText('Remove selected (2)');
    await btn.click();
    await expect(btn).toHaveText('Remove 2?');
    await btn.click();
    await expect(page.locator('.co-pick')).toHaveCount(1);

    await page.locator('#co-select-all').check();
    await expect(page.locator('#co-remove-selected')).toHaveText('Remove selected (1)');
  });
});
