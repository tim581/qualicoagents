/**
 * convert-amazon-cookies.js — merge Cookie-Editor exports → Playwright storage state
 *
 * Inputs (repo root):
 *   amazon-cookies-raw.json      — EU sellercentral.amazon.co.uk session
 *   amazon-cookies-na-raw.json   — NA sellercentral.amazon.com session (optional)
 *   amazon-cookies-ca-raw.json   — CA sellercentral.amazon.ca session (optional)
 *
 * Output:
 *   scripts/amazon-storage-state.json
 *
 * Usage: node scripts/convert-amazon-cookies.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EU_FILE = path.join(ROOT, 'amazon-cookies-raw.json');
const NA_FILE = path.join(ROOT, 'amazon-cookies-na-raw.json');
const CA_FILE = path.join(ROOT, 'amazon-cookies-ca-raw.json');
const OUT = path.join(__dirname, 'amazon-storage-state.json');

function loadJson(file) {
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(raw) ? raw : raw.cookies || [];
}

function toPlaywrightCookie(c) {
  const sameSiteMap = { no_restriction: 'None', none: 'None', lax: 'Lax', strict: 'Strict' };
  let sameSite = 'Lax';
  if (c.sameSite != null) {
    const key = String(c.sameSite).toLowerCase();
    sameSite = sameSiteMap[key] || (key === 'null' ? 'Lax' : 'Lax');
  }
  const expires = c.expirationDate ?? c.expires;
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: c.session ? -1 : Math.floor(Number(expires) || 0),
    httpOnly: !!c.httpOnly,
    secure: c.secure !== false,
    sameSite,
  };
}

function cookieKey(c) {
  return `${c.domain}|${c.path}|${c.name}`;
}

function mergeCookies(lists) {
  const map = new Map();
  for (const list of lists) {
    for (const c of list) {
      if (!c?.name || !c?.domain) continue;
      map.set(cookieKey(c), c);
    }
  }
  return [...map.values()];
}

function main() {
  if (!fs.existsSync(EU_FILE)) {
    console.error(`Missing ${EU_FILE}`);
    console.error('Export cookies from sellercentral.amazon.co.uk via Cookie-Editor.');
    process.exit(1);
  }

  const eu = loadJson(EU_FILE).map(toPlaywrightCookie);
  const na = fs.existsSync(NA_FILE) ? loadJson(NA_FILE).map(toPlaywrightCookie) : [];
  const ca = fs.existsSync(CA_FILE) ? loadJson(CA_FILE).map(toPlaywrightCookie) : [];
  const cookies = mergeCookies([eu, na, ca]);

  fs.writeFileSync(OUT, JSON.stringify({ cookies }, null, 2));
  console.log(`Wrote ${OUT} (${cookies.length} cookies: EU=${eu.length}, NA=${na.length}, CA=${ca.length})`);
}

main();
