const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://partner.bol.com/');

  console.log('');
  console.log('👋 Log handmatig in op Bol.com Partner in het browser venster.');
  console.log('⏳ Ik wacht tot je klaar bent...');
  console.log('');
  console.log('✅ Als je het Partner dashboard ziet:');
  console.log('   Druk hier op ENTER om cookies op te slaan.');
  console.log('');

  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });

  const cookies = await context.cookies();
  const storage = await context.storageState();

  fs.writeFileSync('bol-partner-cookies.json', JSON.stringify(cookies, null, 2));
  fs.writeFileSync('bol-partner-storage-state.json', JSON.stringify(storage, null, 2));

  console.log(`✅ ${cookies.length} cookies opgeslagen in bol-partner-cookies.json`);
  console.log('✅ Storage state opgeslagen in bol-partner-storage-state.json');

  await browser.close();
})();
