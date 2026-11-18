const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

// After Assign Coverage, an outside sub placed in a 6th or 7th grade class
// (advisory included) or a dance class gets listed in a check-in pop-up.

async function runOne(page, course, section) {
  await page.evaluate(({ course, section }) => {
    setRoster([]); // nobody free, so the outside sub takes the one class
    setLog([]);
    document.getElementById('run-date').value = '2026-06-01';
    renderAbsencesTable();
    document.getElementById('outside-sub-count').value = '1';
    const row = document.querySelectorAll('#absences-tbody tr')[0];
    row.querySelector('.abs-teacher').value = '__custom__';
    row.querySelector('.abs-teacher-custom').value = 'Away, Sam';
    row.querySelector('.abs-period').value = '3';
    row.querySelector('.abs-course').value = course;
    row.querySelector('.abs-section').value = section;
  }, { course, section });
  await page.evaluate(() => runCoverage());
  expect(await page.evaluate(() => getLog()[0].coveringTeacher)).toBe('Outside Sub');
}

const modal = '#outside-checkin-modal';

test.beforeEach(async ({ page }) => {
  page.on('dialog', d => d.accept());
  await gotoApp(page);
});

test('a 7th grade advisory covered by an outside sub pops up a check-in', async ({ page }) => {
  await runOne(page, 'Advisory', 'ADV 7-2');
  await expect(page.locator(modal)).toHaveClass(/open/);
  await expect(page.locator('#outside-checkin-tbody')).toContainText('Grade 7 advisory');
  await page.locator(modal).getByRole("button", { name: "Keep These" }).click();
  await expect(page.locator(modal)).not.toHaveClass(/open/);
});

test('a 6th grade class pops up a check-in', async ({ page }) => {
  await runOne(page, 'Science', 'SCI 6-1');
  await expect(page.locator('#outside-checkin-tbody')).toContainText('Grade 6');
});

test('a high school dance class pops up a check-in', async ({ page }) => {
  await runOne(page, 'Dance II', 'PERF 10-1');
  await expect(page.locator('#outside-checkin-tbody')).toContainText('Dance (another building)');
});

test('8th grade and regular high school classes do not pop up a check-in', async ({ page }) => {
  await runOne(page, 'English', 'ENG 8-1');
  await expect(page.locator(modal)).not.toHaveClass(/open/);
  await runOne(page, 'Algebra', 'MATH 10-1');
  await expect(page.locator(modal)).not.toHaveClass(/open/);
});

test('Open Override closes the pop-up and goes to the Override screen', async ({ page }) => {
  await runOne(page, 'Advisory', 'ADV 6-1');
  await page.locator(modal).getByRole("button", { name: "Open Override" }).click();
  await expect(page.locator(modal)).not.toHaveClass(/open/);
  await expect(page.locator('#screen-override')).toHaveClass(/active/);
});

test('an advisory at any grade pops up a check-in', async ({ page }) => {
  await runOne(page, 'Advisory', 'ADV 11-3');
  await expect(page.locator(modal)).toHaveClass(/open/);
  await expect(page.locator('#outside-checkin-tbody')).toContainText('Advisory');
});
