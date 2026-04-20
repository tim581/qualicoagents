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

  const storage = await context.storageState();
  fs.writeFileSync('mintsoft-storage-state.json', JSON.stringify(storage, null, 2));

  const cookies = await context.cookies();
  console.log(`✅ ${cookies.length} cookies opgeslagen in mintsoft-storage-state.json`);
  console.log('🎯 Toekomstige scripts laden deze bestanden automatisch.');

  await browser.close();
  process.exit(0);
})();
