const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { gotoApp } = require('./helpers');

const AXE_SRC = fs.readFileSync(
  require.resolve('axe-core/axe.min.js'),
  'utf8'
);

// Every screen the header nav can reach. Each is scanned with real (if
// minimal) data loaded, since an empty roster/log hides some issues
// (e.g. a table with no rows never renders its empty-action-column header).
const SCREENS = ['run', 'roster', 'log', 'summary', 'override', 'schedule', 'roomchart'];

// A first pass only scanned the 7 top-level screens and missed real
// critical violations inside modals (Teacher Modal, Add-by-Teacher) that
// aren't part of any SCREEN. These open/close pairs are each scanned too.
// Function names, not references: these only exist in the browser, so
// they're looked up via window[...] inside page.evaluate, not called here.
const MODALS = [
  { open: 'openTeacherModal', close: 'closeTeacherModal', id: 'teacher-modal' },
  { open: 'openAddByTeacher', close: 'closeAddByTeacher', id: 'add-by-teacher-modal' },
  { open: 'openResetModal', close: 'closeResetModal', id: 'reset-modal' },
  { open: 'openTripModal', close: 'closeTripModal', id: 'trip-modal' },
];

async function scanAndAssert(page, label, root = 'document') {
  const results = await page.evaluate((rootSelector) => {
    const target = rootSelector === 'document' ? document : document.getElementById(rootSelector);
    return axe.run(target, { resultTypes: ['violations'] });
  }, root);
  const summary = results.violations.map(v => `[${v.impact}] ${v.id} (${v.nodes.length} node(s)): ${v.help}`).join('\n');
  expect(results.violations, `"${label}" has accessibility violations:\n${summary}`).toEqual([]);
}

test.describe('Accessibility (axe-core)', () => {
  test('every top-level screen has zero automatically-detectable violations', async ({ page }) => {
    await gotoApp(page);

    await page.evaluate(() => {
      setRoster([
        { id: 't1', name: 'Jane Smith', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '2026-06-01', previousCoverageDate: '', totalCoverages: 1 },
        { id: 't2', name: 'Bob Jones', tier: 'E', highAvail: false, excluded: false,
          avail: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
          lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
      ]);
      setLog([{ date: '2026-06-01', absentTeacher: 'X', period: 1, courseName: 'Y', coveringTeacher: 'Jane Smith' }]);
    });

    await page.addScriptTag({ content: AXE_SRC });

    for (const screen of SCREENS) {
      await page.evaluate((s) => showScreen(s), screen);
      // Let the nav buttons' 0.15s CSS transition finish, otherwise axe
      // can sample a mid-fade composite color and report a false positive.
      await page.waitForTimeout(200);
      await scanAndAssert(page, `screen "${screen}"`);
    }
  });

  test('every modal has zero automatically-detectable violations', async ({ page }) => {
    await gotoApp(page);
    page.on('dialog', d => d.accept());
    await page.evaluate(() => {
      setRoster([{ id: 't1', name: 'Jane Smith', tier: '1', highAvail: false, excluded: false,
        avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
        lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 }]);
      setLog([]);
    });
    await page.addScriptTag({ content: AXE_SRC });

    for (const modal of MODALS) {
      await page.evaluate((fnName) => window[fnName](), modal.open);
      await page.waitForTimeout(100);
      await scanAndAssert(page, `modal "${modal.id}"`, modal.id);
      await page.evaluate((fnName) => window[fnName](), modal.close);
    }
  });
});
