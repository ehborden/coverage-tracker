// @ts-check
const { defineConfig } = require('@playwright/test');

// This app has no server: every test opens the HTML file directly via a
// file:// URL (see tests/helpers.js). No webServer config needed.
module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
  use: {
    headless: true,
  },
});
