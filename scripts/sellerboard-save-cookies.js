// Sellerboard — Save Cookies
// Run once, log in manually, press Enter to save storage state.

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('🌐 Opening Sellerboard...');
  await page.goto('https://app.sellerboard.com/en/dashboard/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  console.log('');
  console.log('👉 Log in met Tim@qualico.be');
  console.log('👉 Wacht tot dashboard volledig geladen is');
  console.log('👉 Druk dan op ENTER');
  console.log('');

  await new Promise(resolve => process.stdin.once('data', resolve));

  await context.storageState({ path: 'sellerboard-storage-state.json' });
  console.log('✅ Cookies opgeslagen: sellerboard-storage-state.json');
  console.log('⚠️  Sluit dit PowerShell venster nu!');

  await browser.close();
})();
