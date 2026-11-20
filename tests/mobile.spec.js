const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

// At phone width, no screen should make the whole page scroll sideways.
// Wide tables may scroll inside their own card; the page itself must not.
test.use({ viewport: { width: 390, height: 844 } });

test('every screen fits a phone-width window without sideways page scroll', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const t = (id, name) => ({ id, name, tier: '1', highAvail: false, excluded: false,
      avail: { Monday: [2, 5], Tuesday: [1, 3], Wednesday: [2, 4, 6], Thursday: [3], Friday: [1, 7] },
      lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 });
    setRoster([t('t1', 'Testa, Robin'), t('t2', 'Longname-Hyphenated, Alexandra')]);
    setLog([]);
    scheduleData = { 'Testa, Robin': [{ day: 'Monday', period: 1, courseName: 'Algebra II 11-4', section: 'MATH 11-4', room: '403' }] };
  });
  for (const s of ['run', 'roster', 'summary', 'override', 'schedule', 'roomchart']) {
    await page.evaluate(s => showScreen(s), s);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, `screen "${s}"`).toBeLessThanOrEqual(390);
  }
});
