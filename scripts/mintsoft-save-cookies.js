const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { verifyManualSession } = require('./browser-cookie-sessions');

(async () => {
  const outputFile = path.join(__dirname, 'mintsoft-storage-state.json');
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

    await page.goto('https://om.mintsoft.co.uk/UserAccount/LogOn?ReturnUrl=%2fProduct%2f&signInOptions=false', { waitUntil: 'domcontentloaded' });

  console.log('');
  console.log('👋 Log handmatig in op Mintsoft in het browser venster.');
  console.log('⏳ Ik wacht tot je klaar bent...');
  console.log('');
  console.log('✅ Als je ingelogd bent en het dashboard/producten ziet:');
  console.log('   Druk hier op ENTER om cookies op te slaan.');
  console.log('');

    await new Promise(resolve => {
      process.stdin.once('data', resolve);
    });

    await verifyManualSession(page, {
      serviceName: 'Mintsoft',
      isAuthenticatedUrl: (url) => {
        const lower = String(url || '').toLowerCase();
        return lower.includes('om.mintsoft.co.uk') && !lower.includes('/useraccount/logon');
      },
      blockerConfig: {
        loginHints: ['/useraccount/logon', 'signin', 'login'],
        manualHints: ['mfa', '2fa', 'verify', 'challenge', 'captcha'],
      },
      minCookies: 2,
    });

    const storage = await context.storageState();
    fs.writeFileSync(outputFile, JSON.stringify(storage, null, 2));

    const cookies = await context.cookies();
    console.log(`✅ ${cookies.length} cookies opgeslagen in ${outputFile}`);
    console.log('🎯 Toekomstige scripts laden deze bestanden automatisch.');
    require('child_process').execSync('node sync-storage-state-copies.js', {
      cwd: __dirname,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error(`❌ Mintsoft sessie niet bruikbaar: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
  process.exit(process.exitCode || 0);
})();
