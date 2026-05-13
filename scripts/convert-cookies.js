/**
 * convert-cookies.js
 * 
 * Converts Cookie-Editor export (JSON array) to Playwright storage state format.
 * 
 * Usage: node scripts/convert-cookies.js
 * 
 * Input:  cookies-raw.json (Cookie-Editor export, in root folder)
 * Output: bol-storage-state.json (Playwright format, in root folder)
 */

const fs = require('fs');
const path = require('path');

const INPUT = path.join(__dirname, '..', 'cookies-raw.json');
const OUTPUT = path.join(__dirname, '..', 'bol-storage-state.json');

try {
  const raw = JSON.parse(fs.readFileSync(INPUT, 'utf-8'));
  
  // Cookie-Editor exports: [{name, value, domain, path, expires, httpOnly, secure, sameSite}, ...]
  const cookies = raw.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: c.expirationDate || c.expires || -1,
    httpOnly: c.httpOnly || false,
    secure: c.secure || false,
    sameSite: (c.sameSite || 'None').charAt(0).toUpperCase() + (c.sameSite || 'None').slice(1).toLowerCase()
  }));

  const bolCookies = cookies.filter(c => c.domain.includes('bol.com'));

  const storageState = {
    cookies: cookies,
    origins: []
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(storageState, null, 2));

  console.log(`✅ ${cookies.length} cookies geconverteerd (${bolCookies.length} bol.com)`);
  console.log(`✅ Opgeslagen: ${OUTPUT}`);
  console.log('');
  console.log('🎉 bol-cases-scrape kan nu draaien!');
} catch (err) {
  console.error('❌ Error:', err.message);
  console.log('');
  console.log('Zorg dat cookies-raw.json bestaat in de root folder.');
  console.log('(Plak de Cookie-Editor export in dat bestand)');
}
