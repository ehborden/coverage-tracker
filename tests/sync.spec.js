const { test, expect } = require('@playwright/test');
const { gotoApp, makeGithubStore, installGithubMock, connectDeviceToSync, waitForSyncIdle } = require('./helpers');

// Two browser contexts stand in for two computers both pointed at the same
// private GitHub repo. The repo itself is `store`, a plain object the fake
// api.github.com route reads and writes for both contexts, so a write made
// through "device A" is genuinely visible to "device B" on its next sync,
// the same way two real computers would see each other through GitHub.

test.describe('GitHub sync', () => {
  test('a roster edit made independently on each device merges onto both, not just the one that synced last', async ({ page, browser }) => {
    const store = makeGithubStore();
    page.on('dialog', d => d.accept());

    // Device A: add a teacher, then connect. First sync has nothing to
    // merge against, so it just pushes Alice up.
    await installGithubMock(page.context(), store);
    await gotoApp(page);
    await page.evaluate(() => {
      setRoster([{ id: 'a1', name: 'Alice', tier: '1', highAvail: false, excluded: false,
        avail: { Monday: [1], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] },
        lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 }]);
    });
    await connectDeviceToSync(page, { token: 'tok' });
    await waitForSyncIdle(page);

    // Device B: a second, independent computer. It adds its own teacher
    // *before* ever talking to GitHub, so this is a genuine two-sided
    // merge, not B just adopting A's state wholesale.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    pageB.on('dialog', d => d.accept());
    await installGithubMock(contextB, store);
    await gotoApp(pageB);
    await pageB.evaluate(() => {
      setRoster(getRoster().concat([{ id: 'b1', name: 'Bob', tier: '2', highAvail: false, excluded: false,
        avail: { Monday: [], Tuesday: [1], Wednesday: [], Thursday: [], Friday: [] },
        lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 }]));
    });
    await connectDeviceToSync(pageB, { token: 'tok' });
    await waitForSyncIdle(pageB);

    const namesOnB = await pageB.evaluate(() => getRoster().map(t => t.name).sort());
    expect(namesOnB).toEqual(['Alice', 'Bob']);

    // Device A comes back online and syncs again: it should pick up Bob.
    await page.evaluate(() => runSync(['roster', 'log']));
    await waitForSyncIdle(page);
    const namesOnA = await page.evaluate(() => getRoster().map(t => t.name).sort());
    expect(namesOnA).toEqual(['Alice', 'Bob']);

    await contextB.close();
  });

  test('log entries from two devices merge into one log, and coverage totals are rebuilt from the merged result (not just the local half)', async ({ page, browser }) => {
    const store = makeGithubStore();
    page.on('dialog', d => d.accept());

    await installGithubMock(page.context(), store);
    await gotoApp(page);
    await page.evaluate(() => {
      setRoster([{ id: 'j1', name: 'Jane', tier: '1', highAvail: false, excluded: false,
        avail: { Monday: [1], Tuesday: [1], Wednesday: [], Thursday: [], Friday: [] },
        lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 }]);
      setLog([{ date: '2026-06-01', absentTeacher: 'X', period: 1, courseName: 'Y', coveringTeacher: 'Jane' }]);
    });
    await connectDeviceToSync(page, { token: 'tok' });
    await waitForSyncIdle(page);

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    pageB.on('dialog', d => d.accept());
    await installGithubMock(contextB, store);
    await gotoApp(pageB);
    // Device B logs a *different* coverage for the same teacher while it
    // still only knows about its own (not yet synced) copy of the log.
    await pageB.evaluate(() => {
      setLog(getLog().concat([{ date: '2026-06-05', absentTeacher: 'Z', period: 2, courseName: 'Y', coveringTeacher: 'Jane' }]));
    });
    await connectDeviceToSync(pageB, { token: 'tok' });
    await waitForSyncIdle(pageB);

    const onB = await pageB.evaluate(() => ({ log: getLog(), jane: getRoster().find(t => t.name === 'Jane') }));
    expect(onB.log.map(e => e.date).sort()).toEqual(['2026-06-01', '2026-06-05']);
    // Both covering dates counted, not just whichever device happened to sync last.
    expect(onB.jane.totalCoverages).toBe(2);
    expect(onB.jane.lastCoverageDate).toBe('2026-06-05');

    await page.evaluate(() => runSync(['roster', 'log']));
    await waitForSyncIdle(page);
    const onA = await page.evaluate(() => ({ log: getLog(), jane: getRoster().find(t => t.name === 'Jane') }));
    expect(onA.log.map(e => e.date).sort()).toEqual(['2026-06-01', '2026-06-05']);
    expect(onA.jane.totalCoverages).toBe(2);

    await contextB.close();
  });

  test('deleting a teacher on one device removes it on the other after sync, instead of the tombstone being silently dropped', async ({ page, browser }) => {
    const store = makeGithubStore();
    page.on('dialog', d => d.accept());

    await installGithubMock(page.context(), store);
    await gotoApp(page);
    await page.evaluate(() => {
      setRoster([
        { id: 'c1', name: 'Carol', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] }, lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
        { id: 'd1', name: 'Dave', tier: '1', highAvail: false, excluded: false,
          avail: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] }, lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 },
      ]);
    });
    await connectDeviceToSync(page, { token: 'tok' });
    await waitForSyncIdle(page);

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    pageB.on('dialog', d => d.accept());
    await installGithubMock(contextB, store);
    await gotoApp(pageB);
    await connectDeviceToSync(pageB, { token: 'tok' });
    await waitForSyncIdle(pageB);
    expect(await pageB.evaluate(() => getRoster().map(t => t.name).sort())).toEqual(['Carol', 'Dave']);

    // Device A deletes Carol and syncs the deletion up.
    await page.evaluate(() => { setRoster(getRoster().filter(t => t.name !== 'Carol')); });
    await page.evaluate(() => runSync(['roster', 'log']));
    await waitForSyncIdle(page);

    // Device B was already in sync with Carol present locally; it must
    // pick up the deletion rather than keep re-adding her as "new".
    await pageB.evaluate(() => runSync(['roster', 'log']));
    await waitForSyncIdle(pageB);
    expect(await pageB.evaluate(() => getRoster().map(t => t.name).sort())).toEqual(['Dave']);

    await contextB.close();
  });

  test('the Sync with GitHub modal rejects a public repo and connects once the mock reports it private', async ({ page }) => {
    const store = makeGithubStore({ private: false });
    page.on('dialog', d => d.accept());
    await installGithubMock(page.context(), store);
    await gotoApp(page);

    await page.evaluate(() => openSyncModal());
    await page.fill('#sync-owner', 'ehborden');
    await page.fill('#sync-repo', 'coverage-tracker-data');
    await page.fill('#sync-token', 'tok');
    await page.click('#sync-connect-btn');
    await expect(page.locator('#sync-modal-msg')).toContainText('is public');
    expect(await page.evaluate(() => localStorage.getItem('cs_sync'))).toBeNull();

    store.private = true;
    await page.click('#sync-connect-btn');
    await page.waitForFunction(() => !document.getElementById('sync-modal').classList.contains('open'));
    await waitForSyncIdle(page);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cs_sync')).repo)).toBe('coverage-tracker-data');
    expect(await page.locator('#sync-pill').textContent()).toBe('Synced');

    // Turning sync off again leaves local data alone but clears the config.
    await page.evaluate(() => openSyncModal());
    await page.click('#sync-off-btn');
    expect(await page.evaluate(() => localStorage.getItem('cs_sync'))).toBeNull();
    expect(await page.locator('#sync-pill').textContent()).toBe('Sync off');
  });

  test('a bad token shows "Sync problem" instead of silently failing', async ({ page }) => {
    const store = makeGithubStore({ authToken: 'the-real-token' });
    page.on('dialog', d => d.accept());
    await installGithubMock(page.context(), store);
    await gotoApp(page);
    await connectDeviceToSync(page, { token: 'wrong-token' });
    await waitForSyncIdle(page);
    expect(await page.locator('#sync-pill').textContent()).toBe('Sync problem');
  });

  test('the weekly auto-backup lands in backups/ with the expected name after a first full sync', async ({ page }) => {
    const store = makeGithubStore();
    page.on('dialog', d => d.accept());
    await installGithubMock(page.context(), store);
    await gotoApp(page);
    await page.evaluate(() => setRoster([{ id: 't1', name: 'Pat', tier: '1', highAvail: false, excluded: false,
      avail: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] }, lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 }]));
    await connectDeviceToSync(page, { token: 'tok' });
    await waitForSyncIdle(page);
    // autoBackup() fires after the full post-connect sync resolves, as its
    // own further round trip, so give it a moment past "idle" to land.
    await expect.poll(() => [...store.files.keys()].some(p => /^backups\/coverage backup \d{4}-\d{2}-\d{2}\.json$/.test(p)), { timeout: 10000 }).toBe(true);
    const backupPath = [...store.files.keys()].find(p => p.startsWith('backups/'));
    const saved = JSON.parse(Buffer.from(store.files.get(backupPath).content, 'base64').toString('utf8'));
    expect(saved.roster.map(t => t.name)).toEqual(['Pat']);
  });

  test('Restore from GitHub replaces local data with a chosen backup', async ({ page }) => {
    const store = makeGithubStore();
    page.on('dialog', d => d.accept());
    await installGithubMock(page.context(), store);
    await gotoApp(page);

    const backupPayload = {
      exportedAt: '2026-02-01T00:00:00.000Z', version: '1.0',
      roster: [{ id: 'z1', name: 'Zoe', tier: '1', highAvail: false, excluded: false,
        avail: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [] }, lastCoverageDate: '', previousCoverageDate: '', totalCoverages: 0 }],
      log: [], schedule: {}, roomChart: {}, seniorClassesEnded: '0', emailTemplate: '',
      absences: {}, notes: {}, outsideSubCounts: {},
    };
    const body = Buffer.from(JSON.stringify(backupPayload)).toString('base64');
    store.files.set('backups/coverage backup 2026-02-01.json', { content: body, sha: 'sha1' });

    await connectDeviceToSync(page, { token: 'tok' });
    await waitForSyncIdle(page);

    await page.evaluate(() => openRestoreGithubModal());
    // The weekly auto-backup can itself land a same-day backup of the
    // (empty, pre-restore) local state around the same time, so more than
    // one entry can legitimately be in this list — pick the one seeded
    // above by date, not just "the first button".
    await page.waitForSelector('#restore-github-body button[onclick*="2026-02-01"]');
    await page.click('#restore-github-body button[onclick*="2026-02-01"]');
    await page.waitForFunction(() => !document.getElementById('restore-github-modal').classList.contains('open'));

    expect(await page.evaluate(() => getRoster().map(t => t.name))).toEqual(['Zoe']);
  });
});
