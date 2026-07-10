const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { verifyManualSession } = require('./browser-cookie-sessions');

(async () => {
  const outputFile = path.join(__dirname, 'forceget-storage-state.json');
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

    await page.goto('https://app.forceget.com/system/account/login', { waitUntil: 'domcontentloaded' });

  console.log('');
  console.log('👋 Log in op Forceget in het browser venster.');
  console.log('⏳ Wacht tot je het dashboard ziet...');
  console.log('');
  console.log('✅ Als je ingelogd bent: druk ENTER hier.');
  console.log('');

    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });

    await verifyManualSession(page, {
      serviceName: 'Forceget',
      isAuthenticatedUrl: (url) => {
        const lower = String(url || '').toLowerCase();
        return lower.includes('app.forceget.com') && !lower.includes('/login') && !lower.includes('/system/account/login');
      },
      blockerConfig: {
        loginHints: ['/system/account/login', '/login', 'signin'],
        manualHints: ['mfa', '2fa', 'verify', 'challenge', 'captcha'],
      },
      minCookies: 2,
    });

    const storage = await context.storageState();
    fs.writeFileSync(outputFile, JSON.stringify(storage, null, 2));

    const cookies = await context.cookies();
    console.log(`✅ ${cookies.length} cookies opgeslagen in ${outputFile}`);
    require('child_process').execSync('node sync-storage-state-copies.js', {
      cwd: __dirname,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error(`❌ Forceget sessie niet bruikbaar: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
  process.exit(process.exitCode || 0);
})();
