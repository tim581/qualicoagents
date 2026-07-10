'use strict';

/** @deprecated Use integrate-bol-cookies.js — reads legacy cookies-raw.json and delegates */
const path = require('path');
const { integrateBolCookies, printSummary } = require('./integrate-bol-cookies');
const { runSyncStorageStateCopies } = require('./cookie-integrate-shared');

const LEGACY_RAW = path.join(__dirname, '..', 'cookies-raw.json');

console.warn('DEPRECATED: convert-cookies.js — use: node scripts/integrate-bol-cookies.js < cookies.json');
console.warn(`Reading legacy file: ${LEGACY_RAW}\n`);

const fs = require('fs');
if (!fs.existsSync(LEGACY_RAW)) {
  console.error('ERROR: cookies-raw.json not found. Use integrate-bol-cookies.js with your Cookie-Editor export.');
  process.exit(1);
}

try {
  const cookies = JSON.parse(fs.readFileSync(LEGACY_RAW, 'utf8'));
  const result = integrateBolCookies(cookies);
  printSummary(result);
  runSyncStorageStateCopies();
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
