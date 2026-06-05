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
  console.log('👉 Wacht tot dashboard volledig geladen is — cookies worden automatisch opgeslagen');
  console.log('');

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    if (page.isClosed()) {
      console.log('❌ Browser venster gesloten — run opnieuw en laat venster open tot opslaan klaar is');
      process.exit(1);
    }
    const url = page.url();
    const onDashboard = url.includes('/dashboard') && !url.includes('/auth/login');
    if (onDashboard) {
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 });
      } catch {
        await page.waitForTimeout(3000);
      }
      break;
    }
    await page.waitForTimeout(2000);
  }

  if (!page.url().includes('/dashboard') || page.url().includes('/auth/login')) {
    console.log('❌ Login timeout — dashboard niet bereikt binnen 5 minuten');
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: 'sellerboard-storage-state.json' });
  console.log('✅ Cookies opgeslagen: sellerboard-storage-state.json');

  await browser.close();
})();
