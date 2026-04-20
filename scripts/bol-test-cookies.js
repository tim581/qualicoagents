const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: 'bol-storage-state.json' });
  const page = await context.newPage();

  console.log('Loading Bol.com with saved cookies...');
  await page.goto('https://www.bol.com/nl/rnwy/account/overzicht', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const url = page.url();
  console.log('URL:', url);

  if (url.includes('login')) {
    console.log('COOKIES VERLOPEN — run bol-save-cookies.js opnieuw');
  } else {
    console.log('COOKIES WERKEN!');
  }

  await page.waitForTimeout(10000);
  await browser.close();
})();
