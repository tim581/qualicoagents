/**
 * convert-cookies.js
 * Converts Cookie-Editor Chrome extension export format to Playwright storageState format.
 * 
 * Usage:
 * 1. Export cookies from Cookie-Editor extension (copies JSON to clipboard)
 * 2. Paste into cookies-raw.json in this directory
 * 3. Run: node scripts/convert-cookies.js
 * 4. Output: bol-storage-state.json in root of playwright-render-service
 */

const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, '..', 'cookies-raw.json');
const outputFile = path.join(__dirname, '..', 'bol-storage-state.json');

console.log('Reading cookies from:', inputFile);

if (!fs.existsSync(inputFile)) {
  console.error('ERROR: cookies-raw.json not found at', inputFile);
  console.error('Please create this file with the Cookie-Editor export JSON.');
  process.exit(1);
}

let rawCookies;
try {
  const content = fs.readFileSync(inputFile, 'utf8');
  rawCookies = JSON.parse(content);
} catch (e) {
  console.error('ERROR: Failed to parse cookies-raw.json:', e.message);
  process.exit(1);
}

if (!Array.isArray(rawCookies)) {
  console.error('ERROR: cookies-raw.json should contain a JSON array of cookies.');
  process.exit(1);
}

console.log(`Found ${rawCookies.length} cookies to convert.`);

// Convert Cookie-Editor format to Playwright storageState format
const playwrightCookies = rawCookies.map(cookie => {
  const converted = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || '/',
    expires: cookie.expirationDate ? Math.floor(cookie.expirationDate) : -1,
    httpOnly: cookie.httpOnly || false,
    secure: cookie.secure || false,
    sameSite: 'None'
  };

  // Handle sameSite values
  if (cookie.sameSite) {
    const ss = cookie.sameSite.toLowerCase();
    if (ss === 'strict') converted.sameSite = 'Strict';
    else if (ss === 'lax') converted.sameSite = 'Lax';
    else converted.sameSite = 'None';
  }

  return converted;
});

const storageState = {
  cookies: playwrightCookies,
  origins: []
};

fs.writeFileSync(outputFile, JSON.stringify(storageState, null, 2), 'utf8');

console.log(`\n✅ Success! Converted ${playwrightCookies.length} cookies.`);
console.log('Output written to:', outputFile);
console.log('\nYou can now run the bol-cases-scrape task via Browser_Tasks.');
