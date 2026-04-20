const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
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

  const storage = await context.storageState();
  fs.writeFileSync('forceget-storage-state.json', JSON.stringify(storage, null, 2));

  const cookies = await context.cookies();
  console.log(`✅ ${cookies.length} cookies opgeslagen in forceget-storage-state.json`);

  await browser.close();
})();
