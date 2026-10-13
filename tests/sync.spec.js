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

  test('the Connect with GitHub modal rejects a public repo and connects once the mock reports it private', async ({ page }) => {
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

  test('absences entered for different dates on two devices both survive, instead of whichever syncs last wiping every other date', async ({ page, browser }) => {
    const store = makeGithubStore();
    page.on('dialog', d => d.accept());

    // Device A: an absence on June 1.
    await installGithubMock(page.context(), store);
    await gotoApp(page);
    await page.evaluate(() => {
      setData('cs_absences_2026-06-01', [{ teacher: 'Jane Smith', period: 1, course: 'Math' }]);
    });
    await connectDeviceToSync(page, { token: 'tok' });
    await waitForSyncIdle(page);

    // Device B: a second computer, with its own absence on a *different*
    // date (June 8), entered before it ever talks to GitHub — a genuine
    // two-sided merge across dates, not B just adopting A's state.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    pageB.on('dialog', d => d.accept());
    await installGithubMock(contextB, store);
    await gotoApp(pageB);
    await pageB.evaluate(() => {
      setData('cs_absences_2026-06-08', [{ teacher: 'Bob Jones', period: 3, course: 'Science' }]);
    });
    await connectDeviceToSync(pageB, { token: 'tok' });
    await waitForSyncIdle(pageB);

    // B should see both dates, not just its own — the old whole-blob
    // overwrite would have wiped June 1 the moment B pushed.
    const onB = await pageB.evaluate(() => ({
      jun1: getAbsencesByDate('2026-06-01'),
      jun8: getAbsencesByDate('2026-06-08'),
    }));
    expect(onB.jun1).toHaveLength(1);
    expect(onB.jun8).toHaveLength(1);

    // A syncs again and should pick up June 8 without losing its own June 1.
    await page.evaluate(() => runSync(['daily']));
    await waitForSyncIdle(page);
    const onA = await page.evaluate(() => ({
      jun1: getAbsencesByDate('2026-06-01'),
      jun8: getAbsencesByDate('2026-06-08'),
    }));
    expect(onA.jun1).toHaveLength(1);
    expect(onA.jun8).toHaveLength(1);

    await contextB.close();
  });

  test('an absence edit gets pushed within seconds without any other sync trigger, instead of waiting on the next full poll', async ({ page }) => {
    const store = makeGithubStore();
    page.on('dialog', d => d.accept());
    await installGithubMock(page.context(), store);
    await gotoApp(page);
    await connectDeviceToSync(page, { token: 'tok' });
    await waitForSyncIdle(page);

    // Simulate typing an absence, then only the short background check
    // firing (what the 3s interval in initSync does) — never calling
    // runSync() directly, the way a real edit with no other sync trigger
    // nearby would behave.
    await page.evaluate(() => {
      setData('cs_absences_2026-06-01', [{ teacher: 'Jane Smith', period: 1, course: 'Math' }]);
      stampDailyItemChanges();
    });
    await waitForSyncIdle(page);

    const saved = store.files.get('daily.json');
    expect(saved).toBeTruthy();
    const parsed = JSON.parse(Buffer.from(saved.content, 'base64').toString('utf8'));
    const item = parsed.items.find(i => i.date === '2026-06-01');
    expect(item.absences).toHaveLength(1);
  });

  test('an old whole-blob daily.json (from before per-date merge existed) is read correctly, not treated as empty', async ({ page }) => {
    const store = makeGithubStore();
    page.on('dialog', d => d.accept());
    await installGithubMock(page.context(), store);
    await gotoApp(page);

    // The old shape syncBlobFile used to write: one snapshot, one
    // timestamp, absences/notes/etc. keyed by date inside `data`.
    const legacy = {
      app: 'coverage-tracker', file: 'daily', savedAt: '2026-01-01T00:00:00.000Z',
      updated: 1700000000000,
      data: {
        absences: { '2026-06-01': [{ teacher: 'Jane Smith', period: 1, course: 'Math' }] },
        notes: {}, outsideSubCounts: {}, outsideSubUnavail: {},
        seniorClassesEnded: '0', emailTemplate: '',
      },
    };
    const body = Buffer.from(JSON.stringify(legacy)).toString('base64');
    store.files.set('daily.json', { content: body, sha: 'sha1' });

    await connectDeviceToSync(page, { token: 'tok' });
    await waitForSyncIdle(page);

    const absences = await page.evaluate(() => getAbsencesByDate('2026-06-01'));
    expect(absences).toHaveLength(1);
    expect(absences[0].teacher).toBe('Jane Smith');
  });
});
