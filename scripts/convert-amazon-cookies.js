/**
 * convert-amazon-cookies.js
 * =========================
 * Converts Cookie-Editor export (amazon-cookies-raw.json)
 * to Playwright storageState format (amazon-storage-state.json)
 * 
 * Usage:
 *   node scripts/convert-amazon-cookies.js
 * 
 * Input:  amazon-cookies-raw.json  (in root of playwright-render-service/)
 * Output: amazon-storage-state.json (in root of playwright-render-service/)
 */

const fs = require('fs');
const path = require('path');

const INPUT  = path.join(__dirname, '..', 'amazon-cookies-raw.json');
const OUTPUT = path.join(__dirname, '..', 'amazon-storage-state.json');

if (!fs.existsSync(INPUT)) {
  console.error('❌ amazon-cookies-raw.json not found in root folder.');
  console.error('   Export cookies via Cookie-Editor on sellercentral.amazon.com and save as amazon-cookies-raw.json');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(INPUT, 'utf8'));

// Cookie-Editor exports an array of cookie objects
// Playwright storageState expects { cookies: [...], origins: [] }
const playwrightCookies = raw.map(cookie => ({
  name:     cookie.name,
  value:    cookie.value,
  domain:   cookie.domain,
  path:     cookie.path     || '/',
  expires:  cookie.expirationDate ? Math.floor(cookie.expirationDate) : -1,
  httpOnly: cookie.httpOnly || false,
  secure:   cookie.secure   || false,
  sameSite: cookie.sameSite === 'no_restriction' ? 'None'
          : cookie.sameSite === 'lax'            ? 'Lax'
          : cookie.sameSite === 'strict'         ? 'Strict'
          : 'None'
}));

const storageState = {
  cookies: playwrightCookies,
  origins: []
};

fs.writeFileSync(OUTPUT, JSON.stringify(storageState, null, 2));
console.log(`✅ Converted ${playwrightCookies.length} cookies → amazon-storage-state.json`);
console.log('   Ready for Playwright executor!');
