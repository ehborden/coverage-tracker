const path = require('path');

const APP_PATH = path.resolve(__dirname, '..', 'index.html');
const APP_URL = 'file://' + APP_PATH;

// Loads the app fresh. Playwright gives each test an isolated browser
// context, so localStorage never leaks between tests even though every
// test opens the same file:// origin.
async function gotoApp(page) {
  await page.goto(APP_URL);
  await page.waitForSelector('#run-date');
}

// ── Fake GitHub Contents API ────────────────────────────
// A tiny in-memory stand-in for https://api.github.com, shared by every
// device (browser context) that installs it, so two "devices" syncing to
// the "same" repo in a test actually see each other's writes. Backed by
// a plain Map the test file holds onto directly, keyed by content path
// ("roster.json", "backups/coverage backup 2026-01-01.json", ...).

function makeGithubStore(opts = {}) {
  return { files: new Map(), private: opts.private !== false, authToken: opts.authToken || null, _n: 0 };
}

async function installGithubMock(context, store) {
  await context.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (store.authToken) {
      const auth = req.headers()['authorization'] || '';
      if (auth !== `Bearer ${store.authToken}`) return json(401, { message: 'Bad credentials' });
    }

    const parts = url.pathname.split('/').filter(Boolean); // ["repos", owner, repo, "contents", ...path]
    if (parts[0] !== 'repos' || parts.length < 3) return json(404, { message: 'Not Found' });
    if (parts.length === 3) return json(200, { private: store.private });
    if (parts[3] !== 'contents') return json(404, { message: 'Not Found' });

    const filePath = decodeURIComponent(parts.slice(4).join('/'));

    if (method === 'GET') {
      // Directory listing: a path with no file of its own in the store,
      // but files stored "under" it (e.g. "backups").
      const prefix = filePath + '/';
      const under = [...store.files.keys()].filter(p => p.startsWith(prefix));
      if (under.length && !store.files.has(filePath)) {
        return json(200, under.map(p => ({
          name: p.slice(prefix.length), path: p, type: 'file', sha: store.files.get(p).sha,
        })));
      }
      const file = store.files.get(filePath);
      if (!file) return json(404, { message: 'Not Found' });
      return json(200, { sha: file.sha, content: file.content });
    }

    if (method === 'PUT') {
      const body = JSON.parse(req.postData() || '{}');
      const existing = store.files.get(filePath);
      if (existing && body.sha !== existing.sha) return json(409, { message: 'sha does not match' });
      if (!existing && body.sha) return json(422, { message: 'sha given for a file that does not exist' });
      const sha = 'sha' + (++store._n);
      store.files.set(filePath, { content: body.content, sha });
      return json(200, { content: { sha } });
    }

    if (method === 'DELETE') {
      const body = JSON.parse(req.postData() || '{}');
      const existing = store.files.get(filePath);
      if (!existing || (body.sha && body.sha !== existing.sha)) return json(422, { message: 'sha mismatch' });
      store.files.delete(filePath);
      return json(200, {});
    }

    return json(404, { message: 'Not Found' });
  });
}

// Writes cs_sync into localStorage (same shape connectSync() saves) and
// reloads, so the app's own initSync() does the connecting — the same
// path a real device takes, not a shortcut around it.
async function connectDeviceToSync(page, { owner = 'ehborden', repo = 'coverage-tracker-data', token = 'test-token' } = {}) {
  await page.evaluate(({ owner, repo, token }) => {
    localStorage.setItem('cs_sync', JSON.stringify({ owner, repo, token }));
  }, { owner, repo, token });
  await page.reload();
  await page.waitForSelector('#run-date');
}

// Sync runs on a 1.5s debounce timer and the real GitHub round trips
// Playwright's mock resolves instantly, so a short settle plus polling the
// pill's rendered state is enough — no fixed sleep guessing at network time.
async function waitForSyncIdle(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('sync-pill');
    return el && !['pending', 'busy'].includes(el.className.replace('nav-btn', '').trim());
  }, { timeout: 15000 });
}

module.exports = { APP_PATH, APP_URL, gotoApp, makeGithubStore, installGithubMock, connectDeviceToSync, waitForSyncIdle };
