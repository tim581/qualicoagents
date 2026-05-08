// save-bol-session.js
// Launches a stealth browser so you can log in to partner.bol.com manually.
// Once you're logged in and on the dashboard, press ENTER in the terminal.
// The session (cookies + localStorage) is saved to bol-storage-state.json.
// Future Browser_Tasks can reuse this session without logging in again.

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const readline = require('readline');
const path = require('path');

chromium.use(StealthPlugin());

const STATE_FILE = path.join(__dirname, 'bol-storage-state.json');

async function main() {
  console.log('🚀 Launching stealth Chromium...');

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: null, // use full window size
  });

  const page = await context.newPage();

  console.log('🌐 Navigating to partner.bol.com...');
  await page.goto('https://partner.bol.com', { waitUntil: 'domcontentloaded' });

  console.log('');
  console.log('========================================================');
  console.log('  ✅ Browser is open — log in to bol.com manually.');
  console.log('  Navigate wherever you need (dashboard, customer service, etc.)');
  console.log('  Press ENTER here when you are done to save the session.');
  console.log('========================================================');
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question('Press ENTER to save session and close...', resolve));
  rl.close();

  console.log('💾 Saving session state...');
  await context.storageState({ path: STATE_FILE });
  await browser.close();

  console.log(`✅ Session saved to: ${STATE_FILE}`);
  console.log('   The executor will now reuse this session for all bol.com tasks.');
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
