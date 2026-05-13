/**
 * bol-partner-save-cookies.js v3.0.0
 * 
 * APPROACH: Uses your REAL installed Chrome browser (not Playwright's Chromium)
 * This bypasses bol.com's automation detection because it IS a real browser.
 * 
 * Two methods available:
 *   Method 1 (default): Launch real Chrome via Playwright channel
 *   Method 2 (fallback): Connect to already-running Chrome via CDP
 * 
 * Usage:
 *   Method 1: node scripts/bol-partner-save-cookies.js
 *   Method 2: 
 *     1. Close all Chrome windows
 *     2. Start Chrome with: chrome.exe --remote-debugging-port=9222
 *     3. Run: node scripts/bol-partner-save-cookies.js --cdp
 * 
 * Dependencies: playwright (no stealth needed — it's real Chrome!)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const STORAGE_STATE_FILE = path.join(__dirname, '..', 'bol-storage-state.json');
const COOKIES_FILE = path.join(__dirname, '..', 'bol-partner-cookies.json');
const USE_CDP = process.argv.includes('--cdp');

const LOGIN_URL = 'https://login.bol.com/wsp/login?client_id=w2o-sdd-fe&response_type=code&scope=openid&redirect_uri=https://partner.bol.com/sdd/auth/receive';

async function method1_realChrome() {
  console.log('🚀 Method 1: Launching your REAL Chrome browser...');
  console.log('   (niet Playwright Chromium — je echte Chrome installatie)');
  console.log('');
  
  // channel: 'chrome' uses the locally installed Chrome, not Playwright's Chromium
  // This has the real Chrome fingerprint and is not detectable as automation
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam'
  });

  return { browser, context };
}

async function method2_cdp() {
  console.log('🚀 Method 2: Connecting to Chrome via CDP (port 9222)...');
  console.log('   Zorg dat Chrome draait met: chrome.exe --remote-debugging-port=9222');
  console.log('');
  
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const contexts = browser.contexts();
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext();

  return { browser, context, isCDP: true };
}

(async () => {
  console.log('');
  console.log('=== Bol.com Partner Portal — Cookie Saver v3.0 ===');
  console.log('');

  let browser, context, isCDP;

  try {
    if (USE_CDP) {
      ({ browser, context, isCDP } = await method2_cdp());
    } else {
      ({ browser, context } = await method1_realChrome());
    }
  } catch (err) {
    if (!USE_CDP) {
      console.log('❌ Chrome launch mislukt. Probeer Method 2 (CDP):');
      console.log('   1. Sluit alle Chrome vensters');
      console.log('   2. Open CMD en run:');
      console.log('      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222');
      console.log('   3. Run opnieuw: node scripts/bol-partner-save-cookies.js --cdp');
    } else {
      console.log('❌ Kon niet verbinden met Chrome op port 9222.');
      console.log('   Zorg dat Chrome draait met --remote-debugging-port=9222');
    }
    console.error(err.message);
    process.exit(1);
  }

  const page = isCDP 
    ? (await context.pages())[0] || await context.newPage()
    : await context.newPage();

  // Extra anti-detection (belt-and-suspenders)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  console.log('🌐 Navigeren naar bol.com partner login...');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('');
  console.log('✅ Browser is open!');
  console.log('');
  console.log('📋 Stappen:');
  console.log('   1. Log in met accounts@qualico.be');
  console.log('   2. Vul 2FA code in (SMS naar *****242)');
  console.log('   3. Wacht tot je het Partner dashboard ziet');
  console.log('   4. Druk hier op ENTER om cookies op te slaan');
  console.log('');

  await new Promise(resolve => {
    process.stdin.once('data', resolve);
  });

  // Save cookies + storage state
  const cookies = await context.cookies();
  const storage = await context.storageState();

  fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  fs.writeFileSync(STORAGE_STATE_FILE, JSON.stringify(storage, null, 2));

  console.log(`✅ ${cookies.length} cookies opgeslagen in ${COOKIES_FILE}`);
  console.log(`✅ Storage state opgeslagen in ${STORAGE_STATE_FILE}`);
  console.log('');
  console.log('🎉 Klaar! Het bol-cases-scrape script kan nu draaien.');

  await browser.close();
})();
