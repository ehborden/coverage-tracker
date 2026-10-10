const path = require('path');

const APP_PATH = path.resolve(__dirname, '..', 'coverage system 08 26 26 (2) 1.html');
const APP_URL = 'file://' + APP_PATH;

// Loads the app fresh. Playwright gives each test an isolated browser
// context, so localStorage never leaks between tests even though every
// test opens the same file:// origin.
async function gotoApp(page) {
  await page.goto(APP_URL);
  await page.waitForSelector('#run-date');
}

module.exports = { APP_PATH, APP_URL, gotoApp };
