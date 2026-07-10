// Amazon Seller Central — save Playwright storage state after manual login.
// Cookie-Editor exports often work on amazon.de retail but fail on Seller Central SSO in Playwright.
//
// Usage:
//   node scripts/amazon-save-cookies.js
//   node scripts/amazon-save-cookies.js de
//   node scripts/amazon-save-cookies.js uk
//
// Log in in the opened browser; script saves when /home loads.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { chromium } = require('playwright');
const { mergeAllAmazonCookies } = require('./convert-amazon-cookies');

const PORTALS = {
  de: 'https://sellercentral.amazon.de/home',
  uk: 'https://sellercentral.amazon.co.uk/home',
  com: 'https://sellercentral.amazon.com/home',
  ca: 'https://sellercentral.amazon.ca/home',
};

const RAW_OUT = {
  de: path.join(__dirname, '..', 'amazon-cookies-de-raw.json'),
  uk: path.join(__dirname, '..', 'amazon-cookies-raw.json'),
  com: path.join(__dirname, '..', 'amazon-cookies-na-raw.json'),
  ca: path.join(__dirname, '..', 'amazon-cookies-ca-raw.json'),
};

const STORAGE_OUT = path.join(__dirname, 'amazon-storage-state.json');

function portalKey() {
  const arg = (process.argv[2] || 'de').toLowerCase();
  return PORTALS[arg] ? arg : 'de';
}

function toCookieEditor(c) {
  return {
    domain: c.domain,
    expirationDate: c.expires > 0 ? c.expires : undefined,
    hostOnly: !String(c.domain).startsWith('.'),
    httpOnly: c.httpOnly,
    name: c.name,
    path: c.path,
    sameSite: c.sameSite === 'None' ? 'no_restriction' : c.sameSite?.toLowerCase() || null,
    secure: c.secure,
    session: c.expires < 0,
    storeId: null,
    value: c.value,
  };
}

(async () => {
  const key = portalKey();
  const startUrl = PORTALS[key];
  const host = new URL(startUrl).hostname;

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: key === 'uk' ? 'en-GB' : key === 'com' ? 'en-US' : 'en-DE',
    timezoneId: 'Europe/Berlin',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  console.log(`Opening ${startUrl}`);
  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('');
  console.log('Log in manually in the browser window.');
  console.log(`Wait until Seller Central home loads (no /ap/signin in URL).`);
  console.log('');

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    if (page.isClosed()) {
      console.log('Browser closed before login completed.');
      process.exit(1);
    }
    const url = page.url();
    const onHome =
      url.includes(host) &&
      !url.includes('/ap/signin') &&
      !url.includes('/ap/mfa') &&
      (url.includes('/home') || url.includes('/account-switcher'));
    if (onHome) {
      try {
        await page.waitForLoadState('networkidle', { timeout: 15000 });
      } catch {
        await page.waitForTimeout(3000);
      }
      break;
    }
    await page.waitForTimeout(2000);
  }

  const finalUrl = page.url();
  if (finalUrl.includes('/ap/signin') || finalUrl.includes('/ap/mfa')) {
    console.log('Login timeout — Seller Central home not reached within 10 minutes.');
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: STORAGE_OUT });
  console.log(`Saved Playwright storage: ${STORAGE_OUT}`);

  const cookies = await context.cookies();
  const hostCookies = cookies.filter(
    (c) => c.domain.includes(host.replace('sellercentral.', '')) || c.domain.includes(host)
  );
  if (hostCookies.length && RAW_OUT[key]) {
    fs.writeFileSync(RAW_OUT[key], JSON.stringify(hostCookies.map(toCookieEditor), null, 2));
    console.log(`Saved Cookie-Editor raw (${hostCookies.length}): ${RAW_OUT[key]}`);
  }

  await browser.close();

  console.log('\nMerging all Amazon raw files → amazon-storage-state.json...');
  try {
    const mergeResult = mergeAllAmazonCookies();
    console.log(
      `Merged ${mergeResult.total} cookies (UK/EU=${mergeResult.counts.eu}, DE=${mergeResult.counts.de}, ` +
        `NA=${mergeResult.counts.na}, CA=${mergeResult.counts.ca}, Ads=${mergeResult.counts.ads})`,
    );
    execSync('node sync-storage-state-copies.js', { cwd: __dirname, stdio: 'inherit' });
  } catch (err) {
    console.warn('Merge warning:', err.message || err);
    console.warn('Run manually: node scripts/convert-amazon-cookies.js');
  }

  console.log('Done. All Amazon scripts now share scripts/amazon-storage-state.json');
})();
