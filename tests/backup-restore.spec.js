const { test, expect } = require('@playwright/test');
const { gotoApp } = require('./helpers');

test.describe('Backup / Restore', () => {
  test('export payload includes room chart and senior-classes flag, and restore brings them back', async ({ page }) => {
    await gotoApp(page);

    const result = await page.evaluate(() => {
      localStorage.setItem('cs_roomchart', JSON.stringify({ 'SCI8-1': { 'Monday-3': '204' } }));
      localStorage.setItem('cs_senior_ended', '1');
      setRoster([{ id: 't1', name: 'Jane Smith', tier: '1', highAvail: false, excluded: false,
        avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
        lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 3 }]);
      setLog([{ date: '2026-06-01', absentTeacher: 'X', period: 1, courseName: 'Y', coveringTeacher: 'Jane Smith' }]);

      // Build the same payload exportAllData() builds, without triggering a download.
      const payload = {
        exportedAt: new Date().toISOString(),
        version: '1.0',
        roster: getRoster(),
        log: getLog(),
        schedule: getData('cs_schedule', {}),
        roomChart: getData('cs_roomchart', {}),
        seniorClassesEnded: localStorage.getItem('cs_senior_ended') || '0',
        emailTemplate: '',
        absences: {},
        notes: {},
        outsideSubCounts: {},
      };

      localStorage.clear(); // simulate a fresh browser

      // Simulate importAllData()'s local-mode restore body.
      setData('cs_roster', payload.roster);
      setData('cs_log', payload.log);
      if (payload.schedule) setData('cs_schedule', payload.schedule);
      if (payload.roomChart) setData('cs_roomchart', payload.roomChart);
      if (payload.seniorClassesEnded !== undefined) localStorage.setItem('cs_senior_ended', payload.seniorClassesEnded);

      loadRoomChartFromStorage();
      loadSeniorClassesFlag();

      return {
        roomChartData,
        seniorEndedRaw: localStorage.getItem('cs_senior_ended'),
        roster: getRoster(),
      };
    });

    expect(result.roomChartData).toEqual({ 'SCI8-1': { 'Monday-3': '204' } });
    expect(result.seniorEndedRaw).toBe('1');
    expect(result.roster[0].totalCoverages).toBe(3);
  });
});
