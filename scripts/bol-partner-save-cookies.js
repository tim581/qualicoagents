const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox'
    ]
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  // Remove webdriver flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  await page.goto('https://login.bol.com/wsp/login?client_id=w2o-sdd-fe&response_type=code&scope=openid&redirect_uri=https://partner.bol.com/sdd/auth/receive', { waitUntil: 'domcontentloaded' });

  console.log('');
  console.log('Browser is open!');
  console.log('');
  console.log('Stappen:');
  console.log('1. Log in met je Partner account');
  console.log('2. Wacht tot je het Partner dashboard ziet');
  console.log('3. Druk hier op ENTER om cookies op te slaan');
  console.log('');

  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });

  const cookies = await context.cookies();
  const storage = await context.storageState();

  fs.writeFileSync('bol-partner-cookies.json', JSON.stringify(cookies, null, 2));
  fs.writeFileSync('bol-partner-storage-state.json', JSON.stringify(storage, null, 2));

  console.log(`${cookies.length} cookies opgeslagen in bol-partner-cookies.json`);
  console.log('Storage state opgeslagen in bol-partner-storage-state.json');

  await browser.close();
})();
