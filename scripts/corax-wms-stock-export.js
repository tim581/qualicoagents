const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });
  const context = await browser.newContext({
    storageState: 'corax-wms-storage-state.json',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    acceptDownloads: true
  });
  const page = await context.newPage();

  try {
    // Navigate to dashboard
    console.log('1/5 Opening Corax WMS...');
    await page.goto('https://kampspijnacker.coraxwms.nl/#/Dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Check if we're logged in
    const url = page.url();
    if (url.includes('login') || url.includes('Login')) {
      console.log('COOKIES VERLOPEN — run corax-wms-save-cookies.js opnieuw');
      await browser.close();
      process.exit(1);
    }
    console.log('   Ingelogd!');

    // Step 1: Click "Voorraad" in nav menu
    console.log('2/5 Klik Voorraad...');
    await page.click('text=Voorraad');
    await page.waitForTimeout(1000);

    // Step 2: Click "Stocks per artikel" in dropdown
    console.log('3/5 Klik Stocks per artikel...');
    await page.click('text=Stocks per artikel');
    await page.waitForTimeout(3000);

    // Step 3: Click "Exporteren" button
    console.log('4/5 Klik Exporteren...');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.click('text=Exporteren')
    ]).catch(async () => {
      // Maybe there's a confirmation dialog first
      await page.click('text=Exporteren');
      await page.waitForTimeout(1000);
      // Step 4: Click "Ja" in confirmation
      console.log('5/5 Bevestig export (Ja)...');
      const dl = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        page.click('text=Ja')
      ]);
      return dl;
    });

    // If we got here without the catch, try clicking Ja anyway
    if (!download) {
      await page.waitForTimeout(1000);
      console.log('5/5 Bevestig export (Ja)...');
      await page.click('text=Ja');
    }

    // Wait for any pending download
    await page.waitForTimeout(5000);
    console.log('DONE — Export voltooid!');

  } catch (err) {
    console.error('FOUT:', err.message);
  } finally {
    await page.waitForTimeout(3000);
    await browser.close();
  }
})();
