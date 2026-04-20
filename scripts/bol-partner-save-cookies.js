const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('about:blank');

  console.log('');
  console.log('\u{1f44b} Browser is open!');
  console.log('');
  console.log('Stappen:');
  console.log('1. Ga naar partner.bol.com (of de login URL) in de adresbalk');
  console.log('2. Log in met je Partner account');
  console.log('3. Wacht tot je het Partner dashboard ziet');
  console.log('4. Druk hier op ENTER om cookies op te slaan');
  console.log('');

  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });

  const cookies = await context.cookies();
  const storage = await context.storageState();

  fs.writeFileSync('bol-partner-cookies.json', JSON.stringify(cookies, null, 2));
  fs.writeFileSync('bol-partner-storage-state.json', JSON.stringify(storage, null, 2));

  console.log(`\u2705 ${cookies.length} cookies opgeslagen in bol-partner-cookies.json`);
  console.log('\u2705 Storage state opgeslagen in bol-partner-storage-state.json');

  await browser.close();
})();
