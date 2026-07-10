const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { verifyManualSession } = require('./browser-cookie-sessions');

(async () => {
  const cookiesPath = path.join(__dirname, 'corax-wms-cookies.json');
  const statePath = path.join(__dirname, 'corax-wms-storage-state.json');
  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

    console.log('Opening Corax WMS login...');
    await page.goto('https://kampspijnacker.coraxwms.nl/', { waitUntil: 'domcontentloaded' });

  console.log('');
  console.log('Stappen:');
  console.log('1. Log in (of wacht als hij automatisch inlogt)');
  console.log('2. Als je het Dashboard ziet: druk ENTER hier');
  console.log('');

    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });

    await verifyManualSession(page, {
      serviceName: 'Corax WMS',
      isAuthenticatedUrl: (url) => {
        const lower = String(url || '').toLowerCase();
        return lower.includes('coraxwms.nl') && !lower.includes('login') && !lower.includes('microsoftonline');
      },
      blockerConfig: {
        loginHints: ['login', 'signin', 'microsoftonline'],
        manualHints: ['mfa', '2fa', 'verify', 'challenge', 'captcha'],
      },
      minCookies: 2,
    });

    const cookies = await context.cookies();
    const storage = await context.storageState();

    fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
    fs.writeFileSync(statePath, JSON.stringify(storage, null, 2));

    console.log(`${cookies.length} cookies opgeslagen in ${cookiesPath}`);
    console.log(`Storage state opgeslagen in ${statePath}`);
    require('child_process').execSync('node sync-storage-state-copies.js', {
      cwd: __dirname,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error(`❌ Corax WMS sessie niet bruikbaar: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
  process.exit(process.exitCode || 0);
})();
