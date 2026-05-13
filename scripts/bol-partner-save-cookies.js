/**
 * bol-partner-save-cookies.js v2.0.0
 * 
 * Opens een stealth browser met Decodo proxy zodat bol.com
 * het NIET detecteert als automation. Je logt handmatig in
 * en het script slaat de cookies/storage state op.
 * 
 * Het scrape-script (bol-cases-scrape.js) gebruikt deze cookies.
 * 
 * Usage: node scripts/bol-partner-save-cookies.js
 * Dependencies: playwright-extra, puppeteer-extra-plugin-stealth
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

// Stealth plugin — verbergt Playwright fingerprint
chromium.use(StealthPlugin());

// Decodo residential proxy (NL)
const PROXY = {
  server: 'http://nl.decodo.com:10001',
  username: 'spx615l7f1',
  password: 'BHrGlyvt9mRqv2=j62'
};

const STORAGE_STATE_FILE = path.join(__dirname, '..', 'bol-storage-state.json');
const COOKIES_FILE = path.join(__dirname, '..', 'bol-partner-cookies.json');

(async () => {
  console.log('🚀 Starting stealth browser met Decodo NL proxy...');
  console.log(`   Proxy: ${PROXY.server}`);
  
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  const context = await browser.newContext({
    proxy: PROXY,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    geolocation: { latitude: 52.3676, longitude: 4.9041 },
    permissions: ['geolocation']
  });

  const page = await context.newPage();

  // Extra anti-detection
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'languages', { get: () => ['nl-NL', 'nl', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    window.chrome = { runtime: {} };
  });

  console.log('');
  console.log('🌐 Navigeren naar bol.com partner login...');
  
  await page.goto('https://login.bol.com/wsp/login?client_id=w2o-sdd-fe&response_type=code&scope=openid&redirect_uri=https://partner.bol.com/sdd/auth/receive', { 
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });

  console.log('');
  console.log('✅ Browser is open!');
  console.log('');
  console.log('📋 Stappen:');
  console.log('   1. Log in met je Partner account (accounts@qualico.be)');
  console.log('   2. Vul 2FA code in (SMS naar *****242)');
  console.log('   3. Wacht tot je het Partner dashboard ziet');
  console.log('   4. Druk hier op ENTER om cookies op te slaan');
  console.log('');

  // Wacht tot gebruiker op ENTER drukt
  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });

  // Sla cookies en storage state op
  const cookies = await context.cookies();
  const storage = await context.storageState();

  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  fs.writeFileSync(STORAGE_STATE_FILE, JSON.stringify(storage, null, 2));

  console.log(`✅ ${cookies.length} cookies opgeslagen in ${COOKIES_FILE}`);
  console.log(`✅ Storage state opgeslagen in ${STORAGE_STATE_FILE}`);
  console.log('');
  console.log('🎉 Klaar! Je kunt nu bol-cases-scrape.js draaien.');

  await browser.close();
})();
