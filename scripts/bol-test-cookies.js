const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: 'bol-storage-state.json' });
  const page = await context.newPage();

  console.log('Loading Bol.com Partner with saved cookies...');
  await page.goto('https://partner.bol.com/sdd/home/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const url = page.url();
  console.log('URL:', url);

  if (url.includes('login')) {
    console.log('COOKIES VERLOPEN — run bol-save-cookies.js opnieuw');
  } else {
    console.log('COOKIES WERKEN! Partner portal geladen.');
  }

  await page.waitForTimeout(10000);
  await browser.close();
})();
